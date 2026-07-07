// DynamoDB Repository for Rewards Feature
import { GetCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
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

export async function getRedemptionByRewardAndUser(rewardId: string, userId: string): Promise<RewardRedemption | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :userKey',
      FilterExpression: 'rewardId = :rewardId',
      ExpressionAttributeValues: {
        ':userKey': `USER_REDEMPTIONS#${userId}`,
        ':rewardId': rewardId,
      },
      Limit: 1,
    }),
  )
  return result.Items?.[0] ? (result.Items[0] as RewardRedemption) : null
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
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: `REDEMPTION#${redemptionId}`, sk: `REDEMPTION#${redemptionId}` },
      UpdateExpression: updateExpr,
      ConditionExpression: 'attribute_not_exists(redeemedAt) OR redeemedAt = :unredeemed',
      ExpressionAttributeValues: exprValues,
    }),
  )
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

  // Get user's check-ins for this reward's node
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'NodeIndex',
      KeyConditionExpression: 'nodeId = :nodeId',
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':nodeId': reward.nodeId,
        ':userId': userId,
      },
    }),
  )

  const currentCheckIns = result.Count || 0

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
