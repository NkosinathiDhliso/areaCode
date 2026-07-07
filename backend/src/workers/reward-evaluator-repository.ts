// DynamoDB-backed reward evaluator repository (replaces Prisma)
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { generateId } from '../shared/db/entities.js'
import { getActiveRewardsByNodeId } from '../features/rewards/dynamodb-repository.js'
import { getNodeById } from '../features/nodes/dynamodb-repository.js'
import { getCheckInsByNode, getCheckInsByUser } from '../features/check-in/dynamodb-repository.js'

/**
 * Repository layer for reward-evaluator worker.
 * All DynamoDB calls isolated here , zero business logic.
 */

export async function getActiveRewardsForNode(nodeId: string) {
  const rewards = await getActiveRewardsByNodeId(nodeId)
  const node = await getNodeById(nodeId)
  // Look up city
  let citySlug = ''
  if (node?.cityId) {
    const cityResult = await documentClient.send(
      new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${node.cityId}`, sk: `CITY#${node.cityId}` } }),
    )
    citySlug = (cityResult.Item?.['slug'] as string) ?? ''
  }
  return rewards.map((r) => ({
    ...r,
    id: r.rewardId,
    node: node ? { name: node.name, businessId: node.businessId, city: { slug: citySlug } } : null,
  }))
}

export async function createRedemption(data: {
  rewardId: string
  userId: string
  redemptionCode: string
  codeExpiresAt: string
  businessId?: string
  nodeId?: string
  nodeName?: string
  rewardTitle?: string
}) {
  const redemptionId = generateId()
  const now = new Date().toISOString()
  // Canonical redemption row. The `sk` MUST mirror `pk` so that
  // `markRedemptionAsRedeemed` (which keys on { pk: REDEMPTION#id, sk:
  // REDEMPTION#id }) updates THIS row rather than silently creating a
  // phantom one. Per-user lookups go through GSI1 (`USER_REDEMPTIONS#`),
  // which is the only secondary index that exists on the app-data table.
  // `businessId` is denormalised on so the staff-leaderboard scan and the
  // business redemption reports can filter without a node round-trip.
  const item: Record<string, unknown> = {
    pk: `REDEMPTION#${redemptionId}`,
    sk: `REDEMPTION#${redemptionId}`,
    gsi1pk: `USER_REDEMPTIONS#${data.userId}`,
    gsi1sk: now,
    redemptionId,
    rewardId: data.rewardId,
    userId: data.userId,
    redemptionCode: data.redemptionCode,
    codeExpiresAt: data.codeExpiresAt,
    redeemedAt: null,
    createdAt: now,
  }
  if (data.businessId) item['businessId'] = data.businessId
  if (data.nodeId) item['nodeId'] = data.nodeId
  if (data.nodeName) item['nodeName'] = data.nodeName
  if (data.rewardTitle) item['rewardTitle'] = data.rewardTitle

  // Idempotency guard: at most one ACTIVE (unexpired) redemption per
  // (user, reward). A `nth_checkin`/loyalty reward re-qualifies on every
  // check-in past its trigger, so without this guard each subsequent check-in
  // mints a fresh code and the wallet fills with duplicates of the same reward.
  // The write is a conditional put on a deterministic key, so concurrent
  // check-ins race safely: exactly one wins, the loser throws
  // `ConditionalCheckFailedException`, which the reward-evaluator treats as
  // "already claimed" and skips (see reward-evaluator.ts Branch A). The
  // `OR codeExpiresAt < :now` clause lets a repeatable reward be earned again
  // once the previous code has expired.
  const claimKey = `REWARD_CLAIM#${data.rewardId}#${data.userId}`
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: claimKey,
        sk: claimKey,
        rewardId: data.rewardId,
        userId: data.userId,
        redemptionId,
        codeExpiresAt: data.codeExpiresAt,
        createdAt: now,
      },
      ConditionExpression: 'attribute_not_exists(pk) OR codeExpiresAt < :now',
      ExpressionAttributeValues: { ':now': now },
    }),
  )

  try {
    await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  } catch (err) {
    // The claim guard is already written; if the redemption row fails to
    // persist, roll the guard back (best-effort) so the reward is not blocked
    // until expiry before the SQS retry re-mints it. The original error is
    // rethrown loudly so the message fails and retries (no silent drop).
    await documentClient
      .send(new DeleteCommand({ TableName: TableNames.appData, Key: { pk: claimKey, sk: claimKey } }))
      .catch((rollbackErr) => {
        console.error(`[reward-evaluator] claim-guard rollback failed: ${claimKey}`, rollbackErr)
      })
    throw err
  }

  return { id: redemptionId, ...data, createdAt: now }
}

export async function incrementClaimedCount(rewardId: string, maxSlots?: number | null) {
  // When the reward is slot-capped, enforce the cap atomically: the increment
  // only lands if `claimedCount` is still below `maxSlots`. The worker's
  // read-then-check (`claimedCount >= slots`) is a fast early-out, but two
  // concurrent check-ins can both read `slots - 1` and both pass it; without
  // this condition both would increment and the reward over-issues past its
  // cap. A full reward throws `ConditionalCheckFailedException`, which the
  // worker uses to roll back the just-minted redemption.
  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.rewards,
      Key: { rewardId },
      UpdateExpression: 'SET claimedCount = if_not_exists(claimedCount, :zero) + :inc',
      ...(maxSlots != null ? { ConditionExpression: 'attribute_not_exists(claimedCount) OR claimedCount < :max' } : {}),
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ...(maxSlots != null ? { ':max': maxSlots } : {}),
      },
      ReturnValues: 'ALL_NEW',
    }),
  )
  return result.Attributes
}

/**
 * Compensating delete used when a redemption is minted but the slot-cap
 * increment then fails (the last slot was taken by a concurrent claim).
 * Removes both the redemption row and its claim guard so the reward is not
 * left phantom-claimed and the user can earn it again.
 */
export async function deleteRedemption(redemptionId: string, rewardId: string, userId: string) {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `REDEMPTION#${redemptionId}`, sk: `REDEMPTION#${redemptionId}` },
    }),
  )
  const claimKey = `REWARD_CLAIM#${rewardId}#${userId}`
  await documentClient.send(new DeleteCommand({ TableName: TableNames.appData, Key: { pk: claimKey, sk: claimKey } }))
}

export async function countUserCheckInsAtNode(userId: string, nodeId: string) {
  // Query user's check-ins and filter by nodeId + type
  const { checkIns } = await getCheckInsByUser(userId, {})
  return checkIns.filter((ci) => ci.nodeId === nodeId && ci.type === 'reward').length
}

export async function countCheckInsTodayAtNode(nodeId: string) {
  const { checkIns } = await getCheckInsByNode(nodeId, { hours: 24 })
  return checkIns.length
}

export async function getRecentCheckInsForStreak(userId: string, nodeId: string, limit: number) {
  const { checkIns } = await getCheckInsByUser(userId, { limit: limit * 3 }) // over-fetch to filter
  return checkIns
    .filter((ci) => ci.nodeId === nodeId && ci.type === 'reward')
    .slice(0, limit)
    .map((ci) => ({ checkedInAt: ci.checkedInAt }))
}

/**
 * Event/Offer claim gate support (R4.1): does a check-in exist for
 * `(userId, nodeId)` recorded inside the half-open Active_Window
 * `[startsAt, endsAt)`?
 *
 * The `UserIndex` is queried with a `timestamp BETWEEN` range (inclusive on
 * both ends) to bound the fetch; we then re-confirm each candidate against the
 * node and the half-open window using the record's `checkedInAt` ISO string
 * (the same field the rest of the worker keys off). A check-in's numeric
 * `timestamp` SK and its `checkedInAt` ISO string are written from the same
 * instant, so the range query and the precise half-open re-check agree.
 *
 * No type filter is applied: R4.1 only requires *a* check-in at the node inside
 * the window, and the worker itself only runs because such a check-in occurred.
 */
export async function hasCheckInInWindow(
  userId: string,
  nodeId: string,
  startsAt: string,
  endsAt: string,
): Promise<boolean> {
  const startMs = Date.parse(startsAt)
  const endMs = Date.parse(endsAt)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false

  const { checkIns } = await getCheckInsByUser(userId, {
    startTime: startsAt,
    endTime: endsAt,
    limit: 100,
  })

  return checkIns.some((ci) => {
    if (ci.nodeId !== nodeId) return false
    const t = Date.parse(ci.checkedInAt)
    return !Number.isNaN(t) && t >= startMs && t < endMs
  })
}
