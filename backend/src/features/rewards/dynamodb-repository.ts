// DynamoDB Repository for Rewards Feature
import {
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
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
      Key: { pk: `REWARD#${rewardId}`, sk: `REWARD#${rewardId}` },
    })
  )
  return result.Item ? (result.Item as Reward) : null
}

export async function getRewardsByNodeId(nodeId: string): Promise<Reward[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.rewards,
      IndexName: 'NodeIndex',
      KeyConditionExpression: 'nodeId = :nodeId',
      ExpressionAttributeValues: { ':nodeId': nodeId },
    })
  )
  return (result.Items || []) as Reward[]
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
    })
  )
  return (result.Items || []) as Reward[]
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
      Item: {
        pk: `REWARD#${rewardId}`,
        sk: `REWARD#${rewardId}`,
        ...reward,
      },
    })
  )

  return reward
}

export async function updateReward(
  rewardId: string,
  data: Partial<Omit<Reward, 'rewardId' | 'createdAt'>>
): Promise<Reward | null> {
  const updateExpr = Object.keys(data)
    .map((key) => `#${key} = :${key}`)
    .join(', ')

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.rewards,
      Key: { pk: `REWARD#${rewardId}`, sk: `REWARD#${rewardId}` },
      UpdateExpression: `SET ${updateExpr}, #updatedAt = :updatedAt`,
      ExpressionAttributeNames: {
        ...Object.keys(data).reduce((acc, key) => ({ ...acc, [`#${key}`]: key }), {}),
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ...Object.entries(data).reduce((acc, [key, value]) => ({ ...acc, [`:${key}`]: value }), {}),
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    })
  )

  return result.Attributes as Reward
}

export async function incrementRewardClaimCount(rewardId: string): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.rewards,
      Key: { pk: `REWARD#${rewardId}`, sk: `REWARD#${rewardId}` },
      UpdateExpression: 'SET claimedCount = claimedCount + :inc',
      ExpressionAttributeValues: { ':inc': 1 },
    })
  )
}

export async function deleteReward(rewardId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.rewards,
      Key: { pk: `REWARD#${rewardId}`, sk: `REWARD#${rewardId}` },
    })
  )
}

// ============================================================================
// REWARD REDEMPTIONS
// ============================================================================

export async function getRedemptionById(redemptionId: string): Promise<RewardRedemption | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `REDEMPTION#${redemptionId}`, sk: `REDEMPTION#${redemptionId}` },
    })
  )
  return result.Item ? (result.Item as RewardRedemption) : null
}

export async function getRedemptionsByRewardId(rewardId: string): Promise<RewardRedemption[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :rewardId',
      ExpressionAttributeValues: { ':rewardId': `REWARD#${rewardId}` },
    })
  )
  return (result.Items || []) as RewardRedemption[]
}

export async function getRedemptionsByUserId(userId: string): Promise<RewardRedemption[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI2',
      KeyConditionExpression: 'gsi2pk = :userId',
      ExpressionAttributeValues: { ':userId': `USER#${userId}` },
    })
  )
  return (result.Items || []) as RewardRedemption[]
}

export async function getRedemptionByRewardAndUser(
  rewardId: string,
  userId: string
): Promise<RewardRedemption | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :rewardId',
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':rewardId': `REWARD#${rewardId}`,
        ':userId': userId,
      },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? (result.Items[0] as RewardRedemption) : null
}

export async function createRedemption(
  data: Omit<RewardRedemption, 'redemptionId' | 'createdAt'>
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
        gsi1pk: `REWARD#${data.rewardId}`,
        gsi1sk: now,
        gsi2pk: `USER#${data.userId}`,
        gsi2sk: now,
        ...redemption,
      },
    })
  )

  return redemption
}

export async function markRedemptionAsRedeemed(
  redemptionId: string,
  redeemedAt: string = new Date().toISOString()
): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: `REDEMPTION#${redemptionId}`, sk: `REDEMPTION#${redemptionId}` },
      UpdateExpression: 'SET redeemedAt = :redeemedAt',
      ExpressionAttributeValues: { ':redeemedAt': redeemedAt },
    })
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
    })
  )
  return (result.Items || []) as Reward[]
}

export async function getRewardEligibility(
  userId: string,
  rewardId: string
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
      KeyConditionExpression: 'gsi2pk = :nodeId',
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':nodeId': `NODE#${reward.nodeId}`,
        ':userId': userId,
      },
    })
  )

  const currentCheckIns = result.Count || 0
  return {
    currentCheckIns,
    requiredCheckIns: reward.triggerValue,
    eligible: currentCheckIns >= reward.triggerValue,
  }
}
