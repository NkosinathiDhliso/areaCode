/**
 * PrivacyGuard — Core privacy enforcement module.
 *
 * Every data flow that exposes user activity passes through this module.
 * It checks the user's privacyLevel, block records, and mutual follow status
 * before allowing identity data to be exposed.
 *
 * FAIL-CLOSED: If privacy settings cannot be loaded (DynamoDB error),
 * the user is treated as 'private' (most restrictive). A service outage
 * must never accidentally expose private data.
 */

import type { PrivacyLevel, PrivacyVisibility, PrivacyCheckResult } from './types.js'
import { DEFAULT_PRIVACY_LEVEL } from './types.js'

// Lazy imports to avoid circular dependencies
let _getUserById: ((userId: string) => Promise<{ privacyLevel?: string } | null>) | null = null
let _isBlocked: ((blockerId: string, blockedId: string) => Promise<boolean>) | null = null
let _areMutualFollows: ((userA: string, userB: string) => Promise<boolean>) | null = null

/**
 * Initialize PrivacyGuard with repository functions.
 * Called once at app startup to avoid circular imports.
 */
export function initPrivacyGuard(deps: {
  getUserById: (userId: string) => Promise<{ privacyLevel?: string } | null>
  isBlocked: (blockerId: string, blockedId: string) => Promise<boolean>
  areMutualFollows: (userA: string, userB: string) => Promise<boolean>
}) {
  _getUserById = deps.getUserById
  _isBlocked = deps.isBlocked
  _areMutualFollows = deps.areMutualFollows
}

/**
 * Check what visibility a viewer has for a target user's activity.
 *
 * @param targetUserId - The user whose data is being viewed
 * @param viewerId - The user requesting the data (null for anonymous/unauthenticated)
 * @returns PrivacyCheckResult with visibility level and reason
 */
export async function checkPrivacy(targetUserId: string, viewerId: string | null): Promise<PrivacyCheckResult> {
  // Own data is always fully visible
  if (viewerId && viewerId === targetUserId) {
    return { visibility: 'full', reason: 'own_data' }
  }

  // Load target user's privacy level — fail closed on error
  let privacyLevel: PrivacyLevel = DEFAULT_PRIVACY_LEVEL
  try {
    if (_getUserById) {
      const user = await _getUserById(targetUserId)
      privacyLevel = (user?.privacyLevel as PrivacyLevel) ?? DEFAULT_PRIVACY_LEVEL
    }
  } catch {
    // Fail closed — treat as private if we can't load settings
    return { visibility: 'excluded', reason: 'private_profile' }
  }

  // Private users are excluded from all social queries
  if (privacyLevel === 'private') {
    return { visibility: 'excluded', reason: 'private_profile' }
  }

  // Check if target has blocked the viewer (or vice versa)
  if (viewerId && _isBlocked) {
    try {
      const blocked = await _isBlocked(targetUserId, viewerId)
      const reverseBlocked = await _isBlocked(viewerId, targetUserId)
      if (blocked || reverseBlocked) {
        return { visibility: 'excluded', reason: 'blocked' }
      }
    } catch {
      // Fail closed on block check error
      return { visibility: 'excluded', reason: 'blocked' }
    }
  }

  // Public users are visible to everyone
  if (privacyLevel === 'public') {
    return { visibility: 'full', reason: 'public_profile' }
  }

  // Friends-only: check mutual follow status
  if (privacyLevel === 'friends_only') {
    if (!viewerId) {
      return { visibility: 'anonymous', reason: 'not_friends' }
    }

    try {
      if (_areMutualFollows) {
        const mutual = await _areMutualFollows(targetUserId, viewerId)
        if (mutual) {
          return { visibility: 'full', reason: 'mutual_follow' }
        }
      }
    } catch {
      // Fail closed — if we can't check follows, treat as not friends
    }

    return { visibility: 'anonymous', reason: 'not_friends' }
  }

  // Default: anonymous
  return { visibility: 'anonymous', reason: 'not_friends' }
}

/**
 * Filter a list of user activity entries based on privacy rules.
 * Entries from excluded users are removed entirely.
 * Entries from anonymous users have identity fields nulled out.
 *
 * @param entries - Array of entries with userId and identity fields
 * @param viewerId - The user requesting the data
 * @returns Filtered entries with privacy applied
 */
export async function filterByPrivacy<
  T extends { userId: string; displayName?: string | null; username?: string | null; avatarUrl?: string | null },
>(entries: T[], viewerId: string | null): Promise<Array<T & { privacyVisibility: PrivacyVisibility }>> {
  const results: Array<T & { privacyVisibility: PrivacyVisibility }> = []

  for (const entry of entries) {
    const check = await checkPrivacy(entry.userId, viewerId)

    if (check.visibility === 'excluded') {
      continue // Remove entirely
    }

    if (check.visibility === 'anonymous') {
      results.push({
        ...entry,
        displayName: null,
        username: null,
        avatarUrl: null,
        privacyVisibility: 'anonymous',
      })
    } else {
      results.push({
        ...entry,
        privacyVisibility: 'full',
      })
    }
  }

  return results
}

/**
 * Check if a check-in should emit identity data in WebSocket events.
 * Used by the check-in service to decide what to include in toasts.
 *
 * @param userId - The user who checked in
 * @returns Whether identity data (displayName, avatarUrl) can be included in city-wide events
 */
export async function canEmitIdentity(userId: string): Promise<boolean> {
  try {
    if (_getUserById) {
      const user = await _getUserById(userId)
      const level = (user?.privacyLevel as PrivacyLevel) ?? DEFAULT_PRIVACY_LEVEL
      return level === 'public'
    }
  } catch {
    // Fail closed
  }
  return false
}

/**
 * Check whether identity data may be emitted to the user's MUTUAL FRIENDS only
 * (never to strangers). Distinct from `canEmitIdentity`, which gates city-wide
 * (stranger-visible) emission and is intentionally `public`-only.
 *
 * Friend-directed events (`toast:friend_checkin`, `friend:checkout`, the
 * friend-checkin push) fan out solely to the user's mutual follows, so both
 * `public` AND the default `friends_only` must be allowed — sharing presence
 * with friends is exactly what `friends_only` means. Only `private` suppresses
 * it. Fail closed on any error.
 *
 * Without this, default (`friends_only`) users — the majority — would silently
 * emit nothing to their friends, so the belonging signal never lands.
 */
export async function canEmitToFriends(userId: string): Promise<boolean> {
  try {
    if (_getUserById) {
      const user = await _getUserById(userId)
      const level = (user?.privacyLevel as PrivacyLevel) ?? DEFAULT_PRIVACY_LEVEL
      return level !== 'private'
    }
  } catch {
    // Fail closed
  }
  return false
}

/**
 * Sanitize a business check-in event payload.
 * Business owners see display name and tier ONLY — never phone, email,
 * userId, cognitoSub, lat, lng, or any tracking-enabling data.
 */
export function sanitizeForBusiness(data: Record<string, unknown>): Record<string, unknown> {
  const ALLOWED_FIELDS = new Set([
    'nodeId',
    'nodeName',
    'checkInCount',
    'timestamp',
    'displayName',
    'tier',
    'visitCount',
    'type',
  ])

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (ALLOWED_FIELDS.has(key)) {
      sanitized[key] = value
    }
  }
  return sanitized
}
