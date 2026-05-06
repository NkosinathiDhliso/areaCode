// DynamoDB-backed reward evaluator repository (replaces Prisma)
import { GetCommand, PutCommand, UpdateCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
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
    id: r.rewardId ?? (r as any).id,
    node: node ? { name: node.name, businessId: node.businessId, city: { slug: citySlug } } : null,
  }))
}

export async function createRedemption(data: {
  rewardId: string
  userId: string
  redemptionCode: string
  codeExpiresAt: string
}) {
  const redemptionId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `REDEMPTION#${redemptionId}`,
    sk: `USER#${data.userId}`,
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
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: redemptionId, ...data, createdAt: now }
}

export async function incrementClaimedCount(rewardId: string) {
  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.rewards,
      Key: { rewardId },
      UpdateExpression: 'SET claimedCount = if_not_exists(claimedCount, :zero) + :inc',
      ExpressionAttributeValues: { ':zero': 0, ':inc': 1 },
      ReturnValues: 'ALL_NEW',
    }),
  )
  return result.Attributes
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
