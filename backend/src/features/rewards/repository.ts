// DynamoDB-backed Rewards Repository (replaces Prisma)
import { GetCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import * as dynamo from './dynamodb-repository.js'
import { getNodeById } from '../nodes/dynamodb-repository.js'
import { getStaffById } from '../auth/dynamodb-repository.js'

export { getNodeById }
export const getActiveRewardsByNodeId = dynamo.getActiveRewardsByNodeId

export async function createReward(data: {
  nodeId: string
  type: string
  title: string
  description?: string
  triggerValue?: number
  totalSlots?: number
  expiresAt?: string
  isFirstGet?: boolean
  // Event/Offer get attributes (R1.1, R1.3, R1.5). All optional on disk so
  // loyalty gets are unaffected; the service layer resolves defaults.
  getCategory?: 'loyalty' | 'event' | 'offer'
  startsAt?: string
  endsAt?: string
  claimRequiresCheckIn?: boolean
}) {
  return dynamo.createReward(data as any)
}

export async function getRewardById(id: string) {
  const reward = await dynamo.getRewardById(id)
  if (!reward) return null
  const node = await getNodeById(reward.nodeId)
  return {
    ...reward,
    id: reward.rewardId ?? (reward as any).id,
    node: node ? { businessId: node.businessId, name: node.name } : null,
  }
}

export async function updateReward(
  id: string,
  data: Partial<{
    title: string
    description: string
    isActive: boolean
    expiresAt: string | null
    // Event/Offer get attributes (R1.3, R1.6). Threaded through so an update
    // can (re)assert the category and window; undefined fields are dropped
    // before persistence so loyalty rows are untouched.
    getCategory: 'loyalty' | 'event' | 'offer'
    startsAt: string
    endsAt: string
    claimRequiresCheckIn: boolean
  }>,
) {
  return dynamo.updateReward(id, data as any)
}

export async function countActiveRewardsForBusiness(businessId: string) {
  // Get nodes for business, then count active rewards
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodeIds = (nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string)
  let count = 0
  for (const nid of nodeIds) {
    const rewards = await dynamo.getActiveRewardsByNodeId(nid)
    count += rewards.length
  }
  return count
}

export async function getRewardsNearMe(lat: number, lng: number) {
  // Scan active rewards, join with nodes, filter by distance (5km)
  const rewardsResult = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.rewards,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
    }),
  )
  const rewards = rewardsResult.Items || []

  const results = []
  for (const r of rewards) {
    const node = await getNodeById(r['nodeId'] as string)
    if (!node || !node.isActive) continue
    const R = 6371000
    const dLat = ((node.lat - lat) * Math.PI) / 180
    const dLng = ((node.lng - lng) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) * Math.cos((node.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
    const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (distance <= 5000) {
      results.push({
        id: r['rewardId'] ?? r['id'],
        title: r['title'],
        type: r['type'],
        total_slots: r['totalSlots'] ?? null,
        claimed_count: r['claimedCount'] ?? 0,
        node_id: node.nodeId,
        node_name: node.name,
        node_slug: node.slug,
        distance,
        expires_at: r['expiresAt'] ?? null,
        // Event/Offer get attributes threaded through so the service layer can
        // apply the lifecycle filter (R3.2-R3.4). A row written before this
        // feature has no `getCategory`, so surface it as `loyalty` (R1.1).
        getCategory: (r['getCategory'] as 'loyalty' | 'event' | 'offer' | undefined) ?? 'loyalty',
        startsAt: (r['startsAt'] as string | undefined) ?? null,
        endsAt: (r['endsAt'] as string | undefined) ?? null,
      })
    }
  }
  return results.sort((a, b) => a.distance - b.distance).slice(0, 50)
}

export async function getUnclaimedRewards(userId: string) {
  const redemptions = await dynamo.getRedemptionsByUserId(userId)
  const nowIso = new Date().toISOString()
  // Active = not yet redeemed AND not past code expiry. Expired codes stay in
  // the table (90-day analytics window) but must not appear in the wallet.
  const active = redemptions.filter((r) => {
    const rec = r as unknown as Record<string, unknown>
    if (rec['redeemedAt']) return false
    const exp = rec['codeExpiresAt'] as string | undefined
    if (exp && exp < nowIso) return false
    return true
  })

  const enriched = []
  for (const rdm of active) {
    const rec = rdm as unknown as Record<string, unknown>
    // Prefer the denormalised fields written at claim time; fall back to a
    // reward/node lookup for older rows that predate the denormalisation.
    let rewardTitle = (rec['rewardTitle'] as string) ?? ''
    let nodeName = (rec['nodeName'] as string) ?? ''
    let rewardType = ''
    if (!rewardTitle || !nodeName) {
      const reward = rec['rewardId'] ? await dynamo.getRewardById(rec['rewardId'] as string) : null
      if (reward) {
        rewardTitle = rewardTitle || reward.title
        rewardType = reward.type
        if (!nodeName) {
          const node = await getNodeById(reward.nodeId)
          nodeName = node?.name ?? ''
        }
      }
    }
    enriched.push({
      id: (rec['redemptionId'] ?? rec['pk']) as string,
      rewardTitle,
      rewardType,
      redemptionCode: rec['redemptionCode'] as string,
      codeExpiresAt: rec['codeExpiresAt'] as string,
      nodeName,
      createdAt: rec['createdAt'] as string,
    })
  }
  // Newest first (GSI1 already returns descending, but be explicit for the
  // fallback-enriched path).
  return enriched.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

export async function findRedemptionByCode(code: string) {
  // Scan redemptions for code match
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'redemptionCode = :code',
      ExpressionAttributeValues: { ':code': code },
    }),
  )
  if (!result.Items?.[0]) return null
  const rdm = result.Items[0] as Record<string, unknown>
  const reward = rdm['rewardId'] ? await dynamo.getRewardById(rdm['rewardId'] as string) : null
  return {
    id: (rdm['redemptionId'] ?? rdm['pk']) as string,
    rewardId: rdm['rewardId'] as string,
    redemptionCode: rdm['redemptionCode'] as string,
    codeExpiresAt: rdm['codeExpiresAt'] as string | undefined,
    redeemedAt: rdm['redeemedAt'] as string | null,
    userId: rdm['userId'] as string,
    reward: reward ? { title: reward.title } : null,
  }
}

export async function markRedeemed(redemptionId: string, staffId?: string, staffName?: string) {
  return dynamo.markRedemptionAsRedeemed(redemptionId, undefined, staffId, staffName)
}

export async function getRecentRedemptions(businessId: string, limit = 20) {
  // Get all nodes for business → get redemptions from appData
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodeIds = new Set((nodesResult.Items || []).map((n) => (n['nodeId'] ?? n['id']) as string))
  // Scan redemptions and filter
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND attribute_exists(redeemedAt)',
      ExpressionAttributeValues: { ':prefix': 'REDEMPTION#' },
    }),
  )
  const items = (result.Items || [])
    .filter((i) => {
      const rewardId = i['rewardId'] as string
      return !!rewardId // we'd need to check node ownership - simplified
    })
    .slice(0, limit)
    .map((i) => ({ redemptionCode: i['redemptionCode'], redeemedAt: i['redeemedAt'] }))
  return items
}

export async function getStaffRecentRedemptions(staffId: string, limit = 20) {
  const staff = await getStaffById(staffId)
  if (!staff) return []
  return getRecentRedemptions(staff.businessId, limit)
}

export async function getRedemptionsByStaffId(staffId: string, businessId: string, limit = 50) {
  // Scan redemptions from appData filtered by staffId
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND staffId = :staffId',
      ExpressionAttributeValues: { ':prefix': 'REDEMPTION#', ':staffId': staffId },
    }),
  )
  const items = (result.Items || []).slice(0, limit)
  const enriched = []
  for (const rdm of items) {
    const reward = rdm['rewardId'] ? await dynamo.getRewardById(rdm['rewardId'] as string) : null
    let nodeName = ''
    if (reward) {
      const node = await getNodeById(reward.nodeId)
      nodeName = node?.name ?? ''
    }
    enriched.push({
      redemptionId: rdm['redemptionId'] ?? rdm['pk'],
      redemptionCode: rdm['redemptionCode'],
      rewardTitle: reward?.title ?? '',
      nodeName,
      staffId: rdm['staffId'],
      staffName: rdm['staffName'],
      redeemedAt: rdm['redeemedAt'],
      createdAt: rdm['createdAt'],
    })
  }
  return enriched
}
