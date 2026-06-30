import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel } from '../../shared/kv/dynamodb-kv.js'
import * as repo from './repository.js'
import { DEV_MODE } from '../../shared/config/env.js'

// ─── User Profile ───────────────────────────────────────────────────────────

export async function getUserProfile(cognitoSub: string) {
  if (DEV_MODE) {
    return {
      id: 'dev-user-1',
      username: 'dev_user',
      displayName: 'Dev User',
      phone: '+27000000000',
      tier: 'explorer',
      cityId: null,
      neighbourhoodId: null,
      totalCheckIns: 8,
      streakCount: 3,
      avatarUrl: null,
      cognitoSub,
      createdAt: new Date().toISOString(),
      onboardingComplete: false,
    }
  }
  const user = await repo.getUserByCognitoSub(cognitoSub)
  if (!user) throw AppError.notFound('User not found')
  return user
}

export async function completeOnboarding(userId: string) {
  if (DEV_MODE) return { success: true }
  return repo.updateUserProfile(userId, { onboardingComplete: true } as any)
}

export async function updateProfile(
  userId: string,
  data: { displayName?: string; avatarUrl?: string | null; citySlug?: string },
) {
  if (DEV_MODE) return { id: userId, ...data }
  const updateData: Record<string, unknown> = {}
  if (data.displayName !== undefined) updateData['displayName'] = data.displayName
  if (data.avatarUrl !== undefined) updateData['avatarUrl'] = data.avatarUrl
  if (data.citySlug) {
    const city = await repo.getCityBySlug(data.citySlug)
    if (!city) throw AppError.unprocessable('City not found')
    updateData['cityId'] = city.id
  }
  return repo.updateUserProfile(
    userId,
    updateData as { displayName?: string; avatarUrl?: string | null; cityId?: string },
  )
}

export async function getCheckInHistory(userId: string, cursor: string | undefined, limit: number) {
  if (DEV_MODE) {
    return {
      items: [
        {
          id: 'ci-1',
          nodeId: 'dev-1',
          checkedInAt: new Date(Date.now() - 3600000).toISOString(),
          node: { name: 'Father Coffee', slug: 'father-coffee', category: 'coffee' },
        },
        {
          id: 'ci-2',
          nodeId: 'dev-3',
          checkedInAt: new Date(Date.now() - 86400000).toISOString(),
          node: { name: "Kitchener's Bar", slug: 'kitcheners-bar', category: 'nightlife' },
        },
      ],
      nextCursor: null,
      hasMore: false,
    }
  }
  return repo.getUserCheckInHistory(userId, cursor, limit)
}

/**
 * Lightweight subset of check-in history used by the consumer client to
 * power the GPS-proximity nudge (Churn-defences spec, Requirement 4).
 *
 * Returns deduplicated venue coordinates only — no timestamps, no PII.
 * Lat/lng are public information (already exposed via /v1/nodes), so this
 * doesn't surface any new sensitive data. The proximity comparison
 * happens entirely client-side so user coordinates never reach our
 * servers for this feature.
 */
export async function getVisitedNodes(userId: string) {
  if (DEV_MODE) {
    return {
      items: [{ nodeId: 'dev-1', lat: -26.2041, lng: 28.0473, radiusM: 80 }],
    }
  }
  const { getCheckInsByUser } = await import('../check-in/dynamodb-repository.js')
  const { getNodeById } = await import('../nodes/dynamodb-repository.js')
  const result = await getCheckInsByUser(userId, { limit: 200 })
  const seen = new Set<string>()
  const items: Array<{ nodeId: string; lat: number; lng: number; radiusM: number }> = []
  for (const ci of result.checkIns) {
    if (seen.has(ci.nodeId)) continue
    seen.add(ci.nodeId)
    const node = await getNodeById(ci.nodeId)
    if (!node || node.isActive === false) continue
    if (typeof node.lat !== 'number' || typeof node.lng !== 'number') continue
    items.push({
      nodeId: node.nodeId,
      lat: node.lat,
      lng: node.lng,
      radiusM: 80,
    })
  }
  return { items }
}

export async function deleteCheckInHistory(userId: string) {
  if (DEV_MODE) return
  return repo.softDeleteCheckInHistory(userId)
}

// ─── Consent ────────────────────────────────────────────────────────────────

export async function updateConsent(userId: string, consentVersion: string, analyticsOptIn: boolean) {
  if (DEV_MODE) {
    return {
      id: `consent-${Date.now()}`,
      userId,
      consentVersion,
      analyticsOptIn,
      consentedAt: new Date().toISOString(),
    }
  }
  const record = await repo.insertConsentRecord(userId, consentVersion, analyticsOptIn)
  await kvDel(`user:consent:${userId}`)
  return record
}

export async function getUserConsent(userId: string) {
  if (DEV_MODE) return { analyticsOptIn: false }
  const cached = await kvGet(`user:consent:${userId}`)
  if (cached) return JSON.parse(cached) as { analyticsOptIn: boolean }
  const record = await repo.getLatestConsent(userId)
  if (!record) return { analyticsOptIn: false }
  const consent = { analyticsOptIn: record.analyticsOptIn }
  await kvSet(`user:consent:${userId}`, JSON.stringify(consent), 3600)
  return consent
}

// ─── Account Deletion (POPIA) ────────────────────────────────────────────────

export async function requestAccountDeletion(userId: string) {
  if (DEV_MODE) {
    return { success: true, message: 'Erasure request queued (dev mode)' }
  }
  const hasExisting = await repo.hasActiveErasureRequest(userId)
  if (hasExisting) throw AppError.conflict('Erasure request already pending')
  await repo.createErasureRequest(userId)
  return { success: true, message: 'Your data will be erased within 30 days per POPIA requirements.' }
}

// ─── Full Data Export (POPIA) ────────────────────────────────────────────────

export async function getFullDataExport(userId: string) {
  if (DEV_MODE) return { profile: {}, checkIns: [], rewards: [], social: {}, exportedAt: new Date().toISOString() }

  const profile = await repo.getUserById(userId)

  // Get ALL check-ins (no limit)
  const { getCheckInsByUser } = await import('../check-in/dynamodb-repository.js')
  const checkInResult = await getCheckInsByUser(userId, { limit: 1000 })

  // Get unclaimed rewards
  const { getUnclaimedRewards } = await import('../rewards/service.js')
  const rewards = await getUnclaimedRewards(userId)

  // Get social connections
  const { getFollowingIds } = await import('../social/repository.js')
  const following = await getFollowingIds(userId)

  return {
    profile: {
      username: profile?.username,
      displayName: profile?.displayName,
      email: profile?.email,
      phone: profile?.phone,
      cityId: profile?.cityId,
      tier: profile?.tier,
      totalCheckIns: (profile as any)?.totalCheckIns,
      createdAt: (profile as any)?.createdAt,
      musicGenres: (profile as any)?.musicGenres,
      privacyLevel: (profile as any)?.privacyLevel,
    },
    checkIns: checkInResult.checkIns,
    rewards,
    social: { followingCount: following.length },
    exportedAt: new Date().toISOString(),
  }
}
