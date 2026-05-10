// DynamoDB-backed Rewards Repository (replaces Prisma)
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import * as dynamo from './dynamodb-repository.js'
import { getNodeById } from '../nodes/dynamodb-repository.js'
import { getStaffById } from '../auth/dynamodb-repository.js'

export { getNodeById }

export async function createReward(data: {
  nodeId: string
  type: string
  title: string
  description?: string
  triggerValue?: number
  totalSlots?: number
  expiresAt?: string
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
  data: Partial<{ title: string; description: string; isActive: boolean; expiresAt: string | null }>,
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
  // Query active rewards using NodeIndex on rewards table, then filter by distance
  // First get all nodes near the location, then get their rewards
  const { neighbourCells } = await import('../../shared/db/geohash.js')
  const { haversineMetres } = await import('../../shared/db/geohash.js')
  const cells = neighbourCells(lat, lng, 5) // ~5km cells

  const results = []
  const seenRewards = new Set<string>()

  for (const cell of cells) {
    const nodesResult = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.nodes,
        IndexName: 'Geohash5Index',
        KeyConditionExpression: 'geohash5 = :cell',
        FilterExpression: 'isActive = :active',
        ExpressionAttributeValues: { ':cell': cell, ':active': true },
      }),
    )

    for (const node of nodesResult.Items || []) {
      const nodeId = (node['nodeId'] ?? node['id']) as string
      const nodeLat = node['lat'] as number
      const nodeLng = node['lng'] as number
      const distance = haversineMetres(lat, lng, nodeLat, nodeLng)
      if (distance > 5000) continue

      const rewards = await dynamo.getActiveRewardsByNodeId(nodeId)
      for (const r of rewards) {
        const rewardId = r.rewardId ?? (r as unknown as Record<string, unknown>)['id']
        if (seenRewards.has(rewardId as string)) continue
        seenRewards.add(rewardId as string)
        results.push({
          id: rewardId,
          title: r.title,
          type: r.type,
          total_slots: r.totalSlots ?? null,
          claimed_count: r.claimedCount ?? 0,
          node_id: nodeId,
          node_name: node['name'] as string,
          node_slug: node['slug'] as string,
          distance,
          expires_at: r.expiresAt ?? null,
        })
      }
    }
  }
  return results.sort((a, b) => a.distance - b.distance).slice(0, 50)
}

export async function getUnclaimedRewards(userId: string) {
  const redemptions = await dynamo.getRedemptionsByUserId(userId)
  const unclaimed = redemptions.filter((r) => !r.redeemedAt)
  const enriched = []
  for (const rdm of unclaimed) {
    const reward = await dynamo.getRewardById(rdm.rewardId)
    let nodeName = ''
    if (reward) {
      const node = await getNodeById(reward.nodeId)
      nodeName = node?.name ?? ''
    }
    enriched.push({
      ...rdm,
      id: rdm.redemptionId,
      reward: reward ? { title: reward.title, type: reward.type, node: { name: nodeName } } : null,
    })
  }
  return enriched
}

export async function findRedemptionByCode(code: string) {
  // Query redemptions using GSI that indexes by redemption code
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'RedemptionCodeIndex',
      KeyConditionExpression: 'redemptionCode = :code',
      ExpressionAttributeValues: { ':code': code },
      Limit: 1,
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
  // Get all nodes for business → query redemptions from appData using business redemptions index
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `BIZ_REDEMPTIONS#${businessId}` },
      ScanIndexForward: false,
      Limit: limit,
    }),
  )
  const items = (result.Items || []).map((i) => ({
    redemptionCode: i['redemptionCode'],
    redeemedAt: i['redeemedAt'],
  }))
  return items
}

export async function getStaffRecentRedemptions(staffId: string, limit = 20) {
  const staff = await getStaffById(staffId)
  if (!staff) return []
  return getRecentRedemptions(staff.businessId, limit)
}

export async function getRedemptionsByStaffId(staffId: string, businessId: string, limit = 50) {
  // Query redemptions by staff using StaffIndex
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'StaffRedemptionIndex',
      KeyConditionExpression: 'staffId = :staffId',
      ExpressionAttributeValues: { ':staffId': staffId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  )
  const items = result.Items || []
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
