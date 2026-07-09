// DynamoDB-backed reward evaluator repository (replaces Prisma)
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'

import { writeAbuseFlag } from '../features/check-in/abuse.js'
import {
  getCheckInsByNode,
  getCheckInsByUser,
  countQualifyingVisits,
} from '../features/check-in/dynamodb-repository.js'
import { getNodeById } from '../features/nodes/dynamodb-repository.js'
import { getActiveRewardsByNodeId, getRedemptionsByUserId } from '../features/rewards/dynamodb-repository.js'
import { REPEAT_WINDOW_MS, type GuardState, type RepeatPolicy } from '../features/rewards/repeat-policy.js'
import { documentClient, TableNames, isConditionalCheckFailedError } from '../shared/db/dynamodb.js'
import { generateId } from '../shared/db/entities.js'
import { kvIncr } from '../shared/kv/dynamodb-kv.js'

// Qualifying_Visit counter: check-ins with `type = 'reward'` at the node. This
// is the single shared definition (loyalty-repeat-redemption R3.2) used by both
// the evaluator's qualification and the consumer-facing progress read, so the
// two can never disagree (R3.4). Re-exported here so the worker keeps talking
// only to its own repository layer while the definition lives in one home.
export { countQualifyingVisits }

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
  /**
   * Repeat_Policy resolved by the worker (absent → `once`). Selects the
   * Claim_Guard condition expression (loyalty-repeat-redemption R2). Kept
   * optional so callers that predate this feature default to `once`.
   */
  repeatPolicy?: RepeatPolicy
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

  // Policy-aware Claim_Guard write (loyalty-repeat-redemption R2). The guard
  // row (`REWARD_CLAIM#{rewardId}#{userId}`) is the single record of a
  // consumer's claim lifecycle for a reward: it gates minting AND carries the
  // redemption history forward, so one conditional write decides "may a new
  // code be minted right now" for both policies without extra reads or races.
  //
  // The `ConditionExpression` transcribes the accept set of the pure
  // `decideMint` function (repeat-policy.ts), which is the tested source of
  // truth (R2.5). Mapping `decideMint` onto the guard's columns:
  //
  //   guard === null                     -> attribute_not_exists(pk)
  //   no redeemedAt, code expired        -> attribute_not_exists(redeemedAt) AND codeExpiresAt < :now
  //   per_visit, redeemedAt <= now - 4h  -> attribute_exists(redeemedAt) AND redeemedAt <= :cutoff
  //
  // `once` is exactly `decideMint`'s `once` accept set (mint when there is no
  // row, or the current code expired without ever being redeemed). It does NOT
  // test `lastRedeemedAt`: that attribute is set to an epoch sentinel on the
  // first mint by the carry-forward below, so gating on its absence would
  // permanently block the R2.2 "re-mint after an unredeemed expiry" case.
  // `per_visit` adds the redemption-anchored Repeat_Window disjunct so an
  // expired code is not sufficient once a redemption exists (R2.3).
  //
  // ISO-8601 UTC strings compare correctly lexicographically, matching the
  // epoch-ms comparison `decideMint` performs (existing convention).
  //
  // Concurrent check-ins race safely on this deterministic key: exactly one
  // wins, the loser throws `ConditionalCheckFailedException`, which the
  // reward-evaluator treats as "already claimed / skip" (R2.1, R8.2).
  const claimKey = `REWARD_CLAIM#${data.rewardId}#${data.userId}`
  const policy: RepeatPolicy = data.repeatPolicy ?? 'once'
  const epochIso = new Date(0).toISOString()
  const cutoffIso = new Date(Date.parse(now) - REPEAT_WINDOW_MS).toISOString()

  const guardCondition =
    policy === 'per_visit'
      ? 'attribute_not_exists(pk) ' +
        'OR (attribute_not_exists(redeemedAt) AND codeExpiresAt < :now) ' +
        'OR (attribute_exists(redeemedAt) AND redeemedAt <= :cutoff)'
      : 'attribute_not_exists(pk) OR (attribute_not_exists(redeemedAt) AND codeExpiresAt < :now)'

  // On success carry redemption history forward: `lastRedeemedAt` preserves the
  // previous cycle's redemption time (epoch sentinel when none), `redeemedAt`
  // is cleared for the fresh code, and `redemptionCount` powers R8.1 logs and
  // R4.3 evidence. DynamoDB evaluates the update against the pre-update item,
  // so `if_not_exists(redeemedAt, ...)` reads the just-cleared stamp before the
  // REMOVE applies.
  // `ALL_NEW` returns the post-update guard so the worker can read the running
  // `redemptionCount` for the R8.1 repeat-mint log without a second read.
  const guardResult = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: claimKey, sk: claimKey },
      UpdateExpression:
        'SET rewardId = :rewardId, userId = :userId, redemptionId = :rid, codeExpiresAt = :exp, ' +
        'createdAt = :now, lastRedeemedAt = if_not_exists(redeemedAt, if_not_exists(lastRedeemedAt, :epoch)), ' +
        'redemptionCount = if_not_exists(redemptionCount, :zero) + :one REMOVE redeemedAt',
      ConditionExpression: guardCondition,
      ExpressionAttributeValues: {
        ':rewardId': data.rewardId,
        ':userId': data.userId,
        ':rid': redemptionId,
        ':exp': data.codeExpiresAt,
        ':now': now,
        ':epoch': epochIso,
        ':zero': 0,
        ':one': 1,
        ...(policy === 'per_visit' ? { ':cutoff': cutoffIso } : {}),
      },
      ReturnValues: 'ALL_NEW',
    }),
  )
  const redemptionCount = (guardResult.Attributes?.['redemptionCount'] as number | undefined) ?? 1

  try {
    await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  } catch (err) {
    // The claim guard is already written; if the redemption row fails to
    // persist, expire the guard IN PLACE (rather than deleting it) so the
    // carried-forward redemption history survives, while the reward is not
    // blocked until code expiry before the SQS retry re-mints it. Scoped to
    // this mint via `redemptionId = :rid` so a concurrent newer cycle is never
    // clobbered. The original error is rethrown loudly so the message fails and
    // retries (no silent drop). `redemptionCount` is decremented to keep the
    // running count honest for R8.1 / R4.3.
    await documentClient
      .send(
        new UpdateCommand({
          TableName: TableNames.appData,
          Key: { pk: claimKey, sk: claimKey },
          UpdateExpression: 'SET codeExpiresAt = :now, redemptionCount = if_not_exists(redemptionCount, :one) - :one',
          ConditionExpression: 'redemptionId = :rid',
          ExpressionAttributeValues: { ':now': now, ':rid': redemptionId, ':one': 1 },
        }),
      )
      .catch((rollbackErr) => {
        console.error(`[reward-evaluator] claim-guard rollback failed: ${claimKey}`, rollbackErr)
      })
    throw err
  }

  // Surface `redemptionCount` (the running count of mints for this
  // (consumer, reward)) so the worker can emit the R8.1 repeat-mint log.
  return { id: redemptionId, ...data, createdAt: now, redemptionCount }
}

/**
 * Read the current Claim_Guard state for a `(reward, user)` as a `GuardState`
 * (or `null` when no guard row exists). Used only on the mint-skip path to
 * recover the pure `decideMint` rejection code for the R8.2 debug log. Kept in
 * the repository so the worker talks only to its own data layer.
 */
export async function getClaimGuard(rewardId: string, userId: string): Promise<GuardState | null> {
  const claimKey = `REWARD_CLAIM#${rewardId}#${userId}`
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.appData, Key: { pk: claimKey, sk: claimKey } }),
  )
  const item = result.Item
  if (!item || typeof item['codeExpiresAt'] !== 'string') return null
  const guard: GuardState = { codeExpiresAt: item['codeExpiresAt'] as string }
  if (typeof item['redeemedAt'] === 'string') guard.redeemedAt = item['redeemedAt'] as string
  return guard
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
 * Compensating rollback used when a redemption is minted but the slot-cap
 * increment then fails (the last slot was taken by a concurrent claim).
 *
 * Deletes the redemption row, then expires the Claim_Guard IN PLACE rather than
 * deleting it (loyalty-repeat-redemption R2.6). The guard row is now the single
 * record of a consumer's claim lifecycle and carries redemption history
 * (`lastRedeemedAt`, `redemptionCount`); deleting it would erase that history.
 * Expiring in place (`codeExpiresAt = :now`) frees the consumer to earn the get
 * again on the next qualifying visit while the history survives.
 *
 * Scoped to this mint via `redemptionId = :rid` so a concurrent newer cycle is
 * never clobbered; if that condition fails, a newer mint already replaced the
 * guard and there is nothing to roll back, so the failure is swallowed.
 * `redemptionCount` is decremented to keep the running count honest for R8.1 /
 * R4.3.
 */
export async function deleteRedemption(redemptionId: string, rewardId: string, userId: string) {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `REDEMPTION#${redemptionId}`, sk: `REDEMPTION#${redemptionId}` },
    }),
  )
  const claimKey = `REWARD_CLAIM#${rewardId}#${userId}`
  const now = new Date().toISOString()
  await documentClient
    .send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: claimKey, sk: claimKey },
        UpdateExpression: 'SET codeExpiresAt = :now, redemptionCount = if_not_exists(redemptionCount, :one) - :one',
        ConditionExpression: 'redemptionId = :rid',
        ExpressionAttributeValues: { ':now': now, ':rid': redemptionId, ':one': 1 },
      }),
    )
    .catch((err) => {
      if (isConditionalCheckFailedError(err)) return
      throw err
    })
}

/** 24h window for the Reward_Drain counter, matching the KV TTL. */
const DRAIN_TTL_SECONDS = 24 * 60 * 60
/**
 * Mint count at one node in 24h above which a high-priority abuse flag is
 * raised (loyalty-repeat-redemption R4.3). The count is a running total, so
 * "exceeds 3" means the 4th and later mints trip the flag.
 */
const DRAIN_THRESHOLD = 3

/**
 * Reward_Drain-on-mint (loyalty-repeat-redemption R4.1, R4.3, R8.3).
 *
 * Called after a successful mint. Increments the per-`(consumer, node)` drain
 * counter (`abuse:drain:{userId}:{nodeId}`, 24h TTL). The counter keys on
 * `userId`, so omitting `fingerprintHash` cannot bypass it (R4.4); presence
 * check-ins never reach this site (the worker only runs for reward mints), so
 * they never contribute (R4.2). This NEVER blocks the mint — the caller does
 * not await a decision, and any failure here is swallowed and logged.
 *
 * When the running count exceeds `DRAIN_THRESHOLD` in 24h, a high-priority
 * abuse flag is written to the existing admin abuse queue (reusing the shared
 * `writeAbuseFlag`). The evidence carries the actual mint timestamps in the
 * window (the consumer's redemption `createdAt`s at this node, R8.3) and the
 * triggering check-in's `fingerprintHash` when present (R4.1).
 */
export async function recordDrainOnMint(userId: string, nodeId: string, fingerprintHash?: string): Promise<void> {
  try {
    const count = await kvIncr(`abuse:drain:${userId}:${nodeId}`, DRAIN_TTL_SECONDS)
    if (count <= DRAIN_THRESHOLD) return

    // Gather the mint timestamps inside the 24h drain window as evidence for
    // admin review (R8.3): the consumer's redemptions at this node, newest
    // first, filtered to the window.
    const cutoffMs = Date.now() - DRAIN_TTL_SECONDS * 1000
    const redemptions = (await getRedemptionsByUserId(userId)) as Array<{
      nodeId?: string
      createdAt: string
    }>
    const mintTimestamps = redemptions
      .filter((r) => r.nodeId === nodeId && Date.parse(r.createdAt) >= cutoffMs)
      .map((r) => r.createdAt)

    await writeAbuseFlag(userId, {
      type: 'reward_drain',
      priority: 'high',
      evidence: {
        userId,
        nodeId,
        mintCount: count,
        windowHours: 24,
        mintTimestamps,
        ...(fingerprintHash ? { fingerprintHash } : {}),
      },
    })
  } catch (err) {
    // Reward_Drain is a non-blocking abuse signal: a failure here must never
    // affect the mint that already succeeded. Log loudly (no silent swallow)
    // and move on.
    console.error(`[reward-evaluator] recordDrainOnMint failed: user=${userId} node=${nodeId}`, err)
  }
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
