// DynamoDB-backed Nodes Repository (replaces Prisma)
import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import * as dynamo from './dynamodb-repository.js'
import { getActiveRewardsByNodeId } from '../rewards/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'
import { getUserById } from '../auth/dynamodb-repository.js'

export async function getNodesByCitySlug(citySlug: string) {
  // Look up city first
  const city = await getCityBySlug(citySlug)
  if (!city) return []
  // Scan nodes with cityId filter (no CityIndex GSI)
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      FilterExpression: 'cityId = :cityId AND isActive = :active',
      ExpressionAttributeValues: { ':cityId': city.id, ':active': true },
    })
  )
  return (result.Items || []).map((n) => ({
    id: n['nodeId'] ?? n['id'],
    name: n['name'], slug: n['slug'], category: n['category'],
    lat: n['lat'], lng: n['lng'], claimStatus: n['claimStatus'],
    nodeColour: n['nodeColour'], nodeIcon: n['nodeIcon'], isVerified: n['isVerified'],
  }))
}

export async function getNodeById(nodeId: string) {
  const node = await dynamo.getNodeById(nodeId)
  if (!node) return null
  const rewards = await getActiveRewardsByNodeId(nodeId)
  // Look up city
  let city = null
  if (node.cityId) {
    const c = await documentClient.send(
      new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${node.cityId}`, sk: `CITY#${node.cityId}` } })
    )
    city = c.Item ? { name: c.Item['name'], slug: c.Item['slug'] } : null
  }
  return {
    ...node,
    id: node.nodeId ?? (node as any).id,
    rewards: rewards.map((r) => ({
      id: r.rewardId ?? (r as any).id,
      title: r.title, type: r.type,
      totalSlots: r.totalSlots, claimedCount: r.claimedCount, expiresAt: r.expiresAt,
    })),
    city,
  }
}

export async function getNodeBySlug(slug: string) {
  const node = await dynamo.getNodeBySlug(slug)
  if (!node) return null
  const rewards = await getActiveRewardsByNodeId(node.nodeId)
  let city = null
  if (node.cityId) {
    const c = await documentClient.send(
      new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${node.cityId}`, sk: `CITY#${node.cityId}` } })
    )
    city = c.Item ? { name: c.Item['name'], slug: c.Item['slug'] } : null
  }
  return {
    name: node.name, category: node.category, lat: node.lat, lng: node.lng,
    city,
    rewards: rewards.map((r) => ({ id: r.rewardId ?? (r as any).id })),
  }
}

export async function searchNodes(query: string, lat: number, lng: number) {
  // Simple text + distance search (replaces PostGIS pg_trgm)
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
    })
  )
  const q = query.toLowerCase()
  return (result.Items || [])
    .filter((n) => (n['name'] as string || '').toLowerCase().includes(q))
    .map((n) => {
      const nLat = n['lat'] as number; const nLng = n['lng'] as number
      const R = 6371000
      const dLat = ((nLat - lat) * Math.PI) / 180
      const dLng = ((nLng - lng) * Math.PI) / 180
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((nLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return { id: n['nodeId'] ?? n['id'], name: n['name'], slug: n['slug'], category: n['category'], lat: nLat, lng: nLng, similarity: 1, distance }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20) as any[]
}

export async function createNode(data: {
  name: string; slug: string; category: string;
  lat: number; lng: number; cityId: string; submittedBy: string;
}) {
  return dynamo.createNode(data as any)
}

export async function updateNode(
  nodeId: string,
  businessId: string,
  data: Partial<{ name: string; category: string; nodeColour: string; nodeIcon: string; qrCheckinEnabled: boolean }>,
) {
  // Verify node belongs to business
  const node = await dynamo.getNodeById(nodeId)
  if (!node || node.businessId !== businessId) return { count: 0 }
  await dynamo.updateNode(nodeId, data)
  return { count: 1 }
}

export async function claimNode(nodeId: string, businessId: string, cipcStatus: string) {
  const claimStatus = cipcStatus === 'validated' ? 'claimed' : 'pending'
  return dynamo.updateNode(nodeId, { businessId, claimStatus, claimCipcStatus: cipcStatus })
}

export async function createReport(reporterId: string, nodeId: string, type: string, detail?: string) {
  const reportId = generateId()
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `REPORT#${reportId}`, sk: `NODE#${nodeId}`,
        gsi1pk: `NODE_REPORTS#${nodeId}`, gsi1sk: new Date().toISOString(),
        reportId, reporterId, nodeId, type, detail, status: 'pending',
        createdAt: new Date().toISOString(),
      },
    })
  )
  return { id: reportId, reporterId, nodeId, type, detail, status: 'pending' }
}

export async function countRecentFraudReports(nodeId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk >= :since',
      FilterExpression: '#type = :type',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':pk': `NODE_REPORTS#${nodeId}`, ':since': since, ':type': 'fake_rewards' },
    })
  )
  return result.Count ?? 0
}

export async function flagNode(nodeId: string) {
  return dynamo.updateNode(nodeId, { isActive: false })
}

export async function countDismissedReports(reporterId: string) {
  // Simplified: scan reports by reporter
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'reporterId = :rid AND #status = :dismissed',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':rid': reporterId, ':dismissed': 'dismissed' },
    })
  )
  return result.Count ?? 0
}

export async function getWhoIsHere(nodeId: string, limit: number, _cursor?: string) {
  const { checkIns } = await getCheckInsByNode(nodeId, { hours: 1, limit: limit + 1 })
  // Enrich with user data, deduplicate by userId
  const seen = new Set<string>()
  const items = []
  for (const ci of checkIns) {
    if (seen.has(ci.userId)) continue
    seen.add(ci.userId)
    const user = await getUserById(ci.userId)
    if (user) {
      items.push({
        userId: user.userId ?? (user as any).id,
        displayName: user.displayName, username: user.username,
        avatarUrl: user.avatarUrl, tier: user.tier,
        checkedInAt: ci.checkedInAt,
      })
    }
    if (items.length >= limit) break
  }
  const hasMore = checkIns.length > limit
  return { items, nextCursor: null, hasMore }
}

export async function registerNodeImage(nodeId: string, s3Key: string, uploadedBy: string, displayOrder: number) {
  return dynamo.addNodeImage({ nodeId, s3Key, uploadedBy, displayOrder } as any)
}

export async function getCityBySlug(slug: string) {
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${slug}`, sk: `CITY#${slug}` } })
  )
  return result.Item ? { id: result.Item['cityId'] ?? slug, slug, name: result.Item['name'] } : null
}
