// DynamoDB-backed Business Repository (replaces Prisma)
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { randomBytes } from 'node:crypto'
import {
  getBusinessById as getBusinessDynamo,
  updateBusiness,
  getStaffByBusinessId,
} from '../auth/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'

export async function findBusinessById(id: string) {
  return getBusinessDynamo(id)
}

export async function findBusinessByCognitoSub(sub: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.businesses,
      IndexName: 'CognitoIndex',
      KeyConditionExpression: 'cognitoSub = :sub',
      ExpressionAttributeValues: { ':sub': sub },
    })
  )
  return result.Items?.[0] ?? null
}

export async function updateBusinessTier(
  id: string,
  tier: string,
  trialEndsAt?: string | null,
) {
  const data: Record<string, unknown> = { tier }
  if (trialEndsAt !== undefined) data['trialEndsAt'] = trialEndsAt
  return updateBusiness(id, data as any)
}

export async function setPaymentGrace(id: string, until: string | null) {
  return updateBusiness(id, { paymentGraceUntil: until } as any)
}

export async function deactivateBusiness(id: string) {
  return updateBusiness(id, { tier: 'free', isActive: false } as any)
}

export async function setYocoCustomerId(id: string, yocoId: string) {
  return updateBusiness(id, { yocoCustomerId: yocoId } as any)
}

// Staff management
export async function countStaffForBusiness(businessId: string) {
  const staff = await getStaffByBusinessId(businessId)
  return staff.filter((s: any) => s.isActive !== false).length
}

export async function createStaffInvite(
  businessId: string,
  phone?: string,
  email?: string,
) {
  const inviteToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const inviteId = generateId()
  const item = {
    pk: `STAFF_INVITE#${inviteId}`,
    sk: `BIZ#${businessId}`,
    gsi1pk: `BIZ_INVITES#${businessId}`,
    gsi1sk: new Date().toISOString(),
    inviteId, businessId, inviteToken,
    invitedPhone: phone, invitedEmail: email,
    expiresAt, createdAt: new Date().toISOString(),
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return item
}

export async function listStaffAccounts(businessId: string) {
  const staff = await getStaffByBusinessId(businessId)
  return staff.filter((s: any) => s.isActive !== false)
}

export async function removeStaffAccount(id: string, businessId: string) {
  // Update staff in app_data
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: `STAFF#${id}`, sk: `BIZ#${businessId}` },
      UpdateExpression: 'SET isActive = :inactive',
      ExpressionAttributeValues: { ':inactive': false },
    })
  )
  return { count: 1 }
}

// Webhook events (Yoco idempotency)
export async function findWebhookEvent(eventId: string) {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `WEBHOOK#${eventId}`, sk: `WEBHOOK#${eventId}` },
    })
  )
  return result.Item ?? null
}

export async function createWebhookEvent(eventId: string, eventType: string) {
  const item = {
    pk: `WEBHOOK#${eventId}`,
    sk: `WEBHOOK#${eventId}`,
    eventId, eventType,
    createdAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return item
}

// QR token helpers
export async function getNodeForBusiness(nodeId: string, businessId: string) {
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } })
  )
  const node = result.Item
  if (!node || node['businessId'] !== businessId) return null
  return { ...node, id: node['nodeId'] ?? nodeId }
}

// Deactivate all rewards for a business
export async function deactivateBusinessRewards(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    })
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)
  let count = 0
  for (const nid of nodeIds) {
    const rewards = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.rewards,
        FilterExpression: 'nodeId = :nid AND isActive = :active',
        ExpressionAttributeValues: { ':nid': nid, ':active': true },
      })
    )
    for (const r of rewards.Items || []) {
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.rewards,
          Key: { rewardId: r['rewardId'] },
          UpdateExpression: 'SET isActive = :inactive',
          ExpressionAttributeValues: { ':inactive': false },
        })
      )
      count++
    }
  }
  return { count }
}

// ─── Live Stats ─────────────────────────────────────────────────────────────

export async function getLiveStats(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    })
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)

  let checkInsToday = 0
  let totalCheckIns = 0
  for (const nid of nodeIds) {
    const { checkIns: todayCIs } = await getCheckInsByNode(nid, { hours: 24 })
    checkInsToday += todayCIs.length
    const { checkIns: allCIs } = await getCheckInsByNode(nid, {})
    totalCheckIns += allCIs.length
  }

  return { checkInsToday, rewardsClaimed: 0, pulseScore: 0, totalCheckIns }
}

// ─── Business Nodes ─────────────────────────────────────────────────────────

export async function getNodesForBusiness(businessId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    })
  )
  return (result.Items || []).map((n) => ({ ...n, id: n['nodeId'] ?? n['id'] }))
}

// ─── Audience Analytics ─────────────────────────────────────────────────────

export async function getAudienceAnalytics(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    })
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)

  const uniqueUserIds = new Set<string>()
  for (const nid of nodeIds) {
    const { checkIns } = await getCheckInsByNode(nid, {})
    checkIns.forEach((ci) => uniqueUserIds.add(ci.userId))
  }

  return {
    tierDistribution: {},
    repeatVsNew: { repeat: 0, new: uniqueUserIds.size },
    totalUniqueVisitors: uniqueUserIds.size,
    peakHours: [],
  }
}

// ─── Music Audience ─────────────────────────────────────────────────────────

export async function getMusicAudience(_businessId: string) {
  return {
    totalWithMusicPrefs: 0,
    genreDistribution: {},
    archetypeBreakdown: {},
    peakArchetypeByTime: [],
  }
}

// ─── Recent Redemptions ─────────────────────────────────────────────────────

export async function getRecentRedemptions(businessId: string) {
  // Simplified , scan redemptions from appData
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND attribute_exists(redeemedAt)',
      ExpressionAttributeValues: { ':prefix': 'REDEMPTION#' },
    })
  )
  return (result.Items || []).slice(0, 20)
}

// ─── Business Rewards ───────────────────────────────────────────────────────

export async function getRewardsForBusiness(businessId: string) {
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    })
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)
  const allRewards = []
  for (const nid of nodeIds) {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.rewards,
        FilterExpression: 'nodeId = :nid',
        ExpressionAttributeValues: { ':nid': nid },
      })
    )
    allRewards.push(...(result.Items || []).map((r) => ({ ...r, id: r['rewardId'] ?? r['id'] })))
  }
  return allRewards
}
