import { createHash } from 'node:crypto'

import type { FoundVia } from '@area-code/shared/constants/attribution'

import { SAST_OFFSET_MS } from '../../shared/time/sast.js'

import type { AnonymizedCheckIn } from './types.js'

// ============================================================================
// Raw Check-In Shape (fields we expect from DynamoDB)
// ============================================================================

export interface RawCheckIn {
  userId: string
  displayName?: string | null
  phone?: string | null
  email?: string | null
  avatarUrl?: string | null
  nodeId: string
  tier: string
  checkedInAt: string // ISO 8601
  /**
   * Server-derived Found_Via (proof-of-demand R3.1). Absent on check-ins
   * written before the Phase 1 deploy, which `computeReceipt` reads as
   * `walk_in`. Stripped by `anonymizeCheckIns` along with the identifiers.
   */
  foundVia?: FoundVia
}

// ============================================================================
// SAST Timezone Helpers
// ============================================================================

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/**
 * Convert a UTC ISO 8601 timestamp to SAST and extract hourOfDay and dayOfWeek.
 */
function toSAST(isoTimestamp: string): { hourOfDay: number; dayOfWeek: string } {
  const utcDate = new Date(isoTimestamp)
  const sastMs = utcDate.getTime() + SAST_OFFSET_MS
  const sastDate = new Date(sastMs)

  return {
    hourOfDay: sastDate.getUTCHours(),
    dayOfWeek: DAY_NAMES[sastDate.getUTCDay()]!,
  }
}

// ============================================================================
// Anonymization
// ============================================================================

/**
 * Generate a one-way visitor token: SHA-256(userId + salt).
 *
 * The salt is period-stable: it is deliberately NOT mixed with periodStart, so
 * the same user produces the same token in every reporting period. That
 * stability is what makes cross-period repeat-visitor intersection meaningful
 * (a returning visitor maps to an identical token this period and last). Tokens
 * are one-way hashes (no PII) and are only ever persisted server-side with a
 * TTL, never returned to clients.
 */
export function hashVisitorToken(userId: string, salt: string): string {
  return createHash('sha256').update(`${userId}${salt}`).digest('hex')
}

/**
 * Anonymize raw check-ins by stripping all PII and producing
 * AnonymizedCheckIn[] with hashed visitor tokens and SAST time fields.
 */
export function anonymizeCheckIns(rawCheckIns: RawCheckIn[], salt: string): AnonymizedCheckIn[] {
  return rawCheckIns.map((raw) => {
    const { hourOfDay, dayOfWeek } = toSAST(raw.checkedInAt)

    return {
      visitorToken: hashVisitorToken(raw.userId, salt),
      nodeId: raw.nodeId,
      tier: raw.tier,
      checkedInAt: raw.checkedInAt,
      hourOfDay,
      dayOfWeek,
    }
  })
}
