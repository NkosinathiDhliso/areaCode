import { AppError } from '../../shared/errors/AppError.js'
import { getUserById, updateUser } from '../auth/dynamodb-repository.js'
import { blockUser, unblockUser, getBlockedUsers } from '../social/block-repository.js'
import { unfollowUser } from '../social/repository.js'
import { createReport } from '../social/report-repository.js'
import type { PrivacyLevel } from '../../shared/privacy/types.js'
import type { ReportCategory, UserReport } from '../social/report-repository.js'

// ─── Privacy Settings ─────────────────────────────────────────────────────

export async function getPrivacySettings(userId: string): Promise<{ privacyLevel: PrivacyLevel }> {
  const user = await getUserById(userId)
  if (!user) {
    throw AppError.notFound('User not found')
  }
  const privacyLevel = (user.privacyLevel as PrivacyLevel) ?? 'friends_only'
  return { privacyLevel }
}

export async function updatePrivacyLevel(
  userId: string,
  privacyLevel: PrivacyLevel,
): Promise<{ privacyLevel: PrivacyLevel }> {
  const user = await getUserById(userId)
  if (!user) {
    throw AppError.notFound('User not found')
  }
  await updateUser(userId, { privacyLevel })
  return { privacyLevel }
}

// ─── Block / Unblock ──────────────────────────────────────────────────────

export async function blockUserAction(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) {
    throw AppError.badRequest('Cannot block yourself')
  }
  try {
    await blockUser(blockerId, blockedId)
  } catch (err: unknown) {
    // DynamoDB ConditionalCheckFailedException means already blocked
    const error = err as { name?: string }
    if (error.name === 'ConditionalCheckFailedException') {
      throw AppError.conflict('User already blocked')
    }
    throw err
  }

  // Sever the follow graph in BOTH directions. A block record alone does not
  // remove the follow edges, so without this the blocked user would remain a
  // mutual "friend" — still listed as a friend, still counted in each other's
  // taste-match presence, and still receiving friend check-in/checkout events
  // (those friend-scoped fan-outs read the follow graph directly, not the
  // privacy guard). Removing the edges makes the block authoritative across
  // every friend surface at once. Best-effort: a delete failure must not leave
  // the block un-applied, and unfollow is idempotent (a no-op if no edge).
  await Promise.allSettled([unfollowUser(blockerId, blockedId), unfollowUser(blockedId, blockerId)])
}

export async function unblockUserAction(blockerId: string, blockedId: string): Promise<void> {
  await unblockUser(blockerId, blockedId)
}

export async function listBlockedUsers(blockerId: string): Promise<Array<{ blockedId: string; createdAt: string }>> {
  return getBlockedUsers(blockerId)
}

// ─── Reports ──────────────────────────────────────────────────────────────

export async function submitReport(data: {
  reporterId: string
  reportedUserId: string
  category: ReportCategory
  description: string
}): Promise<UserReport> {
  return createReport(data)
}
