/**
 * Reward-threshold grandfathering — Churn-defences spec, Requirement 1.
 *
 * When a consumer makes their first qualifying check-in toward a reward,
 * we snapshot the current threshold (`triggerValue`) into a Threshold_Lock
 * row. If the venue later raises the threshold, this user keeps the
 * original target. If the venue lowers it, the user gets the better deal.
 *
 * This defends against the §1.1 Starbucks-2023 failure mode: half-finished
 * progress bars silently sliding further away.
 *
 * Storage:
 *   pk = LOCK#<userId>#<rewardId>
 *   sk = LOCK
 *   ttl = 90 days after reward expiry (covered by cleanup worker)
 */

import { DeleteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

import { getRewardById, getActiveRewardsByNodeId } from './dynamodb-repository.js'

export interface ThresholdLock {
  userId: string
  rewardId: string
  lockedThreshold: number
  firstCheckInAt: string
  currentVisits: number
}

const SK = 'LOCK'

function pk(userId: string, rewardId: string): string {
  return `LOCK#${userId}#${rewardId}`
}

export async function getLock(userId: string, rewardId: string): Promise<ThresholdLock | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: pk(userId, rewardId), sk: SK },
    }),
  )
  if (!result.Item) return null
  const item = result.Item
  return {
    userId: item['userId'] as string,
    rewardId: item['rewardId'] as string,
    lockedThreshold: item['lockedThreshold'] as number,
    firstCheckInAt: item['firstCheckInAt'] as string,
    currentVisits: item['currentVisits'] as number,
  }
}

/**
 * Effective threshold = the better (lower) of the locked value and the
 * reward's current `triggerValue`. Returns the reward's current threshold
 * when no lock exists.
 */
export async function getEffectiveThreshold(userId: string, rewardId: string): Promise<number> {
  const reward = await getRewardById(rewardId)
  if (!reward?.triggerValue) return 0
  const lock = await getLock(userId, rewardId)
  if (!lock) return reward.triggerValue
  return Math.min(lock.lockedThreshold, reward.triggerValue)
}

/**
 * Pure helper used by tests and by `processCheckInRewardLocks` to compute
 * the threshold a user should be working toward, given an existing lock
 * (if any) and the reward's current value.
 */
export function computeEffectiveThreshold(
  currentRewardThreshold: number,
  existingLockedThreshold: number | null,
): number {
  if (existingLockedThreshold === null) return currentRewardThreshold
  return Math.min(existingLockedThreshold, currentRewardThreshold)
}

interface IncrementInput {
  userId: string
  rewardId: string
  currentThreshold: number
  now?: string
}

/**
 * Idempotently advance a user's progress on a reward.
 *
 * - First qualifying check-in: writes a new lock with `currentVisits=1`
 *   and `lockedThreshold = currentThreshold`.
 * - Subsequent: increments `currentVisits`. If the reward's current
 *   threshold dropped below the lock, lower the lock too (better deal
 *   for the user — Requirement 1.4).
 */
export async function incrementProgress({
  userId,
  rewardId,
  currentThreshold,
  now = new Date().toISOString(),
}: IncrementInput): Promise<ThresholdLock> {
  const existing = await getLock(userId, rewardId)
  if (!existing) {
    const lock: ThresholdLock = {
      userId,
      rewardId,
      lockedThreshold: currentThreshold,
      firstCheckInAt: now,
      currentVisits: 1,
    }
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: { pk: pk(userId, rewardId), sk: SK, ...lock },
      }),
    )
    return lock
  }

  const newLockedThreshold = Math.min(existing.lockedThreshold, currentThreshold)
  const updated: ThresholdLock = {
    ...existing,
    lockedThreshold: newLockedThreshold,
    currentVisits: existing.currentVisits + 1,
  }

  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: pk(userId, rewardId), sk: SK },
      UpdateExpression: 'SET currentVisits = :v, lockedThreshold = :t',
      ExpressionAttributeValues: {
        ':v': updated.currentVisits,
        ':t': updated.lockedThreshold,
      },
    }),
  )
  return updated
}

/**
 * After a check-in is persisted, advance progress on every reward at the
 * venue. Called from the check-in pipeline. Errors are logged but do not
 * fail the check-in itself — losing a lock write is recoverable, losing
 * a check-in is not.
 */
export async function processCheckInRewardLocks(userId: string, nodeId: string): Promise<void> {
  let rewards
  try {
    rewards = await getActiveRewardsByNodeId(nodeId)
  } catch (err) {
    console.warn(`[threshold-lock] Failed to list rewards for node ${nodeId}: ${String(err)}`)
    return
  }

  for (const reward of rewards) {
    const threshold = (reward as { triggerValue?: number }).triggerValue
    if (typeof threshold !== 'number' || threshold <= 0) continue
    const rewardId = (reward as { rewardId?: string; id?: string }).rewardId ?? (reward as { id?: string }).id
    if (!rewardId) continue
    try {
      await incrementProgress({ userId, rewardId, currentThreshold: threshold })
    } catch (err) {
      console.warn(`[threshold-lock] Failed to advance lock for user=${userId} reward=${rewardId}: ${String(err)}`)
    }
  }
}

export async function deleteLock(userId: string, rewardId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: pk(userId, rewardId), sk: SK },
    }),
  )
}

/**
 * Cleanup pass: remove locks whose reward no longer exists. Called from
 * the daily cleanup worker. Bounded by the number of LOCK# rows; at our
 * scale that's small. If LOCK# rows grow significantly, switch to a GSI.
 */
export async function cleanupOrphanedLocks(): Promise<{ deleted: number }> {
  let exclusiveStartKey: Record<string, unknown> | undefined
  let deleted = 0
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.appData,
        FilterExpression: 'begins_with(pk, :prefix)',
        ExpressionAttributeValues: { ':prefix': 'LOCK#' },
        ProjectionExpression: 'pk, sk, rewardId',
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      const reward = await getRewardById(item['rewardId'] as string).catch(() => null)
      if (!reward) {
        await documentClient.send(
          new DeleteCommand({
            TableName: TableNames.appData,
            Key: { pk: item['pk'] as string, sk: item['sk'] as string },
          }),
        )
        deleted++
      }
    }
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)
  return { deleted }
}
