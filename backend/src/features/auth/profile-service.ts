import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel } from '../../shared/kv/dynamodb-kv.js'
import * as repo from './repository.js'

// ─── User Profile ───────────────────────────────────────────────────────────

export async function getUserProfile(cognitoSub: string) {
  const user = await repo.getUserByCognitoSub(cognitoSub)
  if (!user) throw AppError.notFound('User not found')
  return user
}

export async function completeOnboarding(userId: string) {
  return repo.updateUserProfile(userId, { onboardingComplete: true } as any)
}

export async function updateProfile(
  userId: string,
  data: { displayName?: string; avatarUrl?: string | null; citySlug?: string },
) {
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
  return repo.getUserCheckInHistory(userId, cursor, limit)
}

export async function deleteCheckInHistory(userId: string) {
  return repo.softDeleteCheckInHistory(userId)
}

// ─── Consent ────────────────────────────────────────────────────────────────

export async function updateConsent(userId: string, consentVersion: string, analyticsOptIn: boolean) {
  const record = await repo.insertConsentRecord(userId, consentVersion, analyticsOptIn)
  await kvDel(`user:consent:${userId}`)
  return record
}

export async function getUserConsent(userId: string) {
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
  const hasExisting = await repo.hasActiveErasureRequest(userId)
  if (hasExisting) throw AppError.conflict('Erasure request already pending')
  await repo.createErasureRequest(userId)
  return { success: true, message: 'Your data will be erased within 30 days per POPIA requirements.' }
}
