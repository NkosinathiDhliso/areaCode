// DynamoDB Repository for Rewards Feature
import { GetCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames, isConditionalCheckFailedError } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'

import type { Reward, RewardRedemption } from './types.js'

// ============================================================================
// REWARD OPERATIONS
// ============================================================================

export async function getRewardById(rewardId: string): Promise<Reward | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.rewards,
      Key: { rewardId },
    }),
  )
  return result.Item ? mapReward(result.Item) : null
}

export async function getRewardsByNodeId(nodeId: string): Promise<Reward[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.rewards,
      IndexName: 'NodeIndex',
      KeyConditionExpression: 'nodeId = :nodeId',
      ExpressionAttributeValues: { ':nodeId': nodeId },
    }),
  )
  return (result.Items || []).map((i) => mapReward(i))
}

export async function getActiveRewardsByNodeId(nodeId: string): Promise<Reward[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.rewards,
      IndexName: 'NodeIndex',
      KeyConditionExpression: 'nodeId = :nodeId',
      FilterExpression: 'isActive = :isActive AND (expiresAt > :now OR attribute_not_exists(expiresAt))',
      ExpressionAttributeValues: {
        ':nodeId': nodeId,
        ':isActive': true,
        ':now': new Date().toISOString(),
      },
    }),
  )
  return (result.Items || []).map((i) => mapReward(i))
}

export async function createReward(data: Omit<Reward, 'rewardId' | 'createdAt'>): Promise<Reward> {
  const rewardId = generateId()
  const now = new Date().toISOString()

  const reward: Reward = {
    ...data,
    rewardId,
    createdAt: now,
    updatedAt: now,
    isActive: data.isActive ?? true,
    claimedCount: data.claimedCount || 0,
    slotsLocked: data.slotsLocked ?? false,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.rewards,
      Item: { ...reward, id: rewardId },
    }),
  )

  return mapReward(reward as unknown as Record<string, unknown>)
}

export async function updateReward(
  rewardId: string,
  data: Partial<Omit<Reward, 'rewardId' | 'createdAt'>>,
): Promise<Reward | null> {
  // Only persist attributes that are actually present. Threading optional
  // event/offer fields (`getCategory`, `startsAt`, `endsAt`,
  // `claimRequiresCheckIn`) through here means undefined values must be
  // dropped before building the expression — otherwise the UpdateExpression
  // would reference a value that `removeUndefinedValues` strips out.
  const definedEntries = Object.entries(data).filter(([, value]) => value !== undefined)

  if (definedEntries.length === 0) {
    return getRewardById(rewardId)
  }

  const updateExpr = definedEntries.map(([key]) => `#${key} = :${key}`).join(', ')

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.rewards,
      Key: { rewardId },
      UpdateExpression: `SET ${updateExpr}, #updatedAt = :updatedAt`,
      ExpressionAttributeNames: {
        ...definedEntries.reduce((acc, [key]) => ({ ...acc, [`#${key}`]: key }), {}),
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ...definedEntries.reduce((acc, [key, value]) => ({ ...acc, [`:${key}`]: value }), {}),
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }),
  )

  return result.Attributes ? mapReward(result.Attributes) : null
}

export async function incrementRewardClaimCount(rewardId: string): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.rewards,
      Key: { rewardId },
      UpdateExpression: 'SET claimedCount = claimedCount + :inc',
      ExpressionAttributeValues: { ':inc': 1 },
    }),
  )
}

export async function deleteReward(rewardId: string): Promise<void> {
  await documentClient.send(new DeleteCommand({ TableName: TableNames.rewards, Key: { rewardId } }))
}

// ============================================================================
// REWARD REDEMPTIONS
// ============================================================================

export async function getRedemptionById(redemptionId: string): Promise<RewardRedemption | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `REDEMPTION#${redemptionId}`, sk: `REDEMPTION#${redemptionId}` },
    }),
  )
  return result.Item ? (result.Item as RewardRedemption) : null
}

export async function getRedemptionsByRewardId(rewardId: string): Promise<RewardRedemption[]> {
  // Redemption rows carry `rewardId` as a plain attribute (the only GSI on
  // app-data is GSI1, used for per-user lookups). Scan + filter is acceptable
  // here: this is an admin/analytics path, not a hot consumer query.
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND rewardId = :rewardId',
      ExpressionAttributeValues: { ':prefix': 'REDEMPTION#', ':rewardId': rewardId },
    }),
  )
  return (result.Items || []) as RewardRedemption[]
}

export async function getRedemptionsByUserId(userId: string): Promise<RewardRedemption[]> {
  // Per-user lookup via GSI1 (`USER_REDEMPTIONS#{userId}`), newest first.
  // This is the only secondary index on the app-data table — the previous
  // implementation queried a non-existent "GSI2", so every wallet read threw.
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :userKey',
      ExpressionAttributeValues: { ':userKey': `USER_REDEMPTIONS#${userId}` },
      ScanIndexForward: false,
    }),
  )
  return (result.Items || []) as RewardRedemption[]
}

export async function createRedemption(
  data: Omit<RewardRedemption, 'redemptionId' | 'createdAt'>,
): Promise<RewardRedemption> {
  const redemptionId = generateId()
  const now = new Date().toISOString()

  const redemption: RewardRedemption = {
    ...data,
    redemptionId,
    createdAt: now,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `REDEMPTION#${redemptionId}`,
        sk: `REDEMPTION#${redemptionId}`,
        gsi1pk: `USER_REDEMPTIONS#${data.userId}`,
        gsi1sk: now,
        ...redemption,
      },
    }),
  )

  return redemption
}

export async function markRedemptionAsRedeemed(
  redemptionId: string,
  redeemedAt: string = new Date().toISOString(),
  staffId?: string,
  staffName?: string,
): Promise<void> {
  let updateExpr = 'SET redeemedAt = :redeemedAt'
  const exprValues: Record<string, unknown> = { ':redeemedAt': redeemedAt }

  if (staffId) {
    updateExpr += ', staffId = :staffId'
    exprValues[':staffId'] = staffId
  }
  if (staffName) {
    updateExpr += ', staffName = :staffName'
    exprValues[':staffName'] = staffName
  }

  // Guard against double-redeem races: only flip the row if it has NOT already
  // been redeemed. A redemption row is created with `redeemedAt: null`, so the
  // attribute exists but is null on an unredeemed code; a redeemed row holds an
  // ISO string. Without this, two concurrent confirms (double-tap, retry, or
  // two staff devices scanning the same code) both pass the service-layer
  // `redeemedAt` null check and both write, handing out the reward twice for
  // one code. The conditional write makes exactly one confirm win; the loser
  // throws `ConditionalCheckFailedException`, which the service maps to
  // `already_redeemed`. Mirrors the guest-claim token guard.
  exprValues[':unredeemed'] = null
  // Flip the redemption row FIRST — it is the authoritative double-redeem gate
  // (loyalty-repeat-redemption R2.4). `ALL_NEW` returns the updated item so we
  // can read `rewardId`/`userId` off it to build the Claim_Guard key without a
  // second read.
  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: `REDEMPTION#${redemptionId}`, sk: `REDEMPTION#${redemptionId}` },
      UpdateExpression: updateExpr,
      ConditionExpression: 'attribute_not_exists(redeemedAt) OR redeemedAt = :unredeemed',
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }),
  )

  // R2.4: stamp the redemption time onto the Claim_Guard row for this
  // (consumer, reward) AFTER the redemption row has flipped. This makes the
  // re-mint decision (R2.2 `once`, R2.3 `per_visit` Repeat_Window) decidable by
  // the guard's conditional write alone. A failed stamp is logged loudly and
  // NEVER rolls back the redemption: the consumer stays blocked from re-minting
  // until the current code's expiry, which fails toward the business rather
  // than toward a free extra mint.
  await stampClaimGuardRedemption(result.Attributes, redemptionId, redeemedAt)
}

/**
 * Stamp `redeemedAt` onto the Claim_Guard row (`REWARD_CLAIM#{rewardId}#{userId}`)
 * for a just-redeemed code (loyalty-repeat-redemption R2.4).
 *
 * Conditioned on `redemptionId = :rid AND attribute_not_exists(redeemedAt)` so
 * the stamp can only ever attach to the guard while it still points at THIS
 * code and has not already been stamped — it can never land on a newer cycle's
 * code. The redemption row is the authoritative double-redeem gate and has
 * already flipped by the time we get here (ordering: row first, guard second),
 * so this stamp is purely the re-mint bookkeeping.
 *
 * Failure handling is fail-closed toward the business (R2.4): we do NOT roll
 * back the redemption on a stamp failure. A `ConditionalCheckFailedException`
 * is the benign no-op case (a legacy guard row with no `redemptionId` per R2.7,
 * or a guard already advanced/stamped); anything else is logged loudly. In both
 * cases the consumer simply stays blocked until the current code's `codeExpiresAt`.
 */
async function stampClaimGuardRedemption(
  redemptionItem: Record<string, unknown> | undefined,
  redemptionId: string,
  redeemedAt: string,
): Promise<void> {
  const rewardId = redemptionItem?.['rewardId'] as string | undefined
  const userId = redemptionItem?.['userId'] as string | undefined
  if (!rewardId || !userId) {
    // Cannot build the guard key without both ids. Fail toward the business:
    // log loudly and leave the consumer blocked until code expiry.
    console.error(`[rewards] claim-guard stamp skipped: redemption ${redemptionId} missing rewardId/userId`)
    return
  }

  const claimKey = `REWARD_CLAIM#${rewardId}#${userId}`
  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: claimKey, sk: claimKey },
        UpdateExpression: 'SET redeemedAt = :t',
        ConditionExpression: 'redemptionId = :rid AND attribute_not_exists(redeemedAt)',
        ExpressionAttributeValues: { ':t': redeemedAt, ':rid': redemptionId },
      }),
    )
  } catch (err) {
    if (isConditionalCheckFailedError(err)) {
      // Benign no-op: the guard is a legacy row without `redemptionId` (R2.7),
      // or it has already advanced to a newer cycle / been stamped. The consumer
      // stays gated by `codeExpiresAt` as they do today. Surface it, don't swallow.
      console.warn(`[rewards] claim-guard stamp no-op (legacy/advanced guard): ${claimKey} rid=${redemptionId}`)
      return
    }
    // Real stamp failure (throttling, network, etc.). Log loudly and fail toward
    // the business — the redemption stands and the consumer stays blocked until
    // the current code expires (R2.4). Never roll back the redemption.
    console.error(`[rewards] claim-guard stamp FAILED: ${claimKey} rid=${redemptionId}`, err)
  }
}

// ============================================================================
// REWARD EVALUATION
// ============================================================================

export async function getRewardsNeedingEvaluation(): Promise<Reward[]> {
  // Get rewards with triggerValue set and not locked
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.rewards,
      FilterExpression: 'attribute_exists(triggerValue) AND slotsLocked = :locked AND isActive = :active',
      ExpressionAttributeValues: {
        ':locked': false,
        ':active': true,
      },
    }),
  )
  return (result.Items || []).map((i) => mapReward(i))
}

export function mapReward(item: Record<string, unknown>): Reward {
  const copy = { ...item } as Record<string, unknown>
  copy['id'] = item['rewardId'] as string
  copy['rewardId'] = item['rewardId'] as string
  // R1.1 / R7.1: rows persisted before this feature lack a `getCategory`
  // attribute. Surface them as `loyalty` so callers never observe `undefined`
  // and every legacy row keeps its existing behaviour without a backfill.
  copy['getCategory'] = (item['getCategory'] as Reward['getCategory']) ?? 'loyalty'
  // R1.1 / R7.1: rows persisted before this feature lack a `repeatPolicy`
  // attribute. Surface them as `once` (the deliberate default, R1.2) so callers
  // never observe `undefined` and legacy rows stop repeating — no backfill.
  copy['repeatPolicy'] = (item['repeatPolicy'] as Reward['repeatPolicy']) ?? 'once'
  return copy as unknown as Reward
}

export async function getRewardEligibility(
  userId: string,
  rewardId: string,
): Promise<{ currentCheckIns: number; requiredCheckIns: number; eligible: boolean }> {
  const reward = await getRewardById(rewardId)
  if (!reward || !reward.triggerValue) {
    return { currentCheckIns: 0, requiredCheckIns: 0, eligible: false }
  }

  // Count Qualifying_Visits (reward-type check-ins at this node) via the single
  // shared counter (loyalty-repeat-redemption R3.2). The previous read counted
  // all check-in types, so displayed progress could disagree with the
  // evaluator's qualification; both now share one definition (R3.4). This
  // corrects the displayed count downward where non-reward check-ins existed.
  const { countQualifyingVisits } = await import('../check-in/dynamodb-repository.js')
  const currentCheckIns = await countQualifyingVisits(userId, reward.nodeId)

  // Apply threshold-lock: a user halfway to a reward keeps their original
  // target if the venue raises the threshold (Churn-defences spec, Req 1).
  let requiredCheckIns = reward.triggerValue
  try {
    const { getEffectiveThreshold } = await import('./threshold-lock.js')
    requiredCheckIns = await getEffectiveThreshold(userId, rewardId)
    if (requiredCheckIns === 0) requiredCheckIns = reward.triggerValue
  } catch {
    // Lock lookup failure is non-fatal — fall back to current threshold
  }

  return {
    currentCheckIns,
    requiredCheckIns,
    eligible: currentCheckIns >= requiredCheckIns,
  }
}
