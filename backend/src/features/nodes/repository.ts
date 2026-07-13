// DynamoDB-backed Nodes Repository (replaces Prisma)
import { normaliseSocialLinks } from '@area-code/shared/constants/social-platforms'
import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { getUserById } from '../auth/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'
import { getActiveRewardsByNodeId } from '../rewards/dynamodb-repository.js'

import { isBoostActive } from './boost.js'
import * as dynamo from './dynamodb-repository.js'

const PAID_TIERS_SET = new Set(['starter', 'growth', 'pro', 'payg'])

export async function getNodesByCitySlug(citySlug: string) {
  // Look up city first
  const city = await getCityBySlug(citySlug)
  if (!city) return []
  // Anchored read via the CityIndex GSI (hash key cityId), paginated over
  // LastEvaluatedKey so every matching row is read — no unanchored full-table
  // Scan (R2.1). isActive stays a FilterExpression on the GSI query.
  const items: Record<string, unknown>[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.nodes,
        IndexName: 'CityIndex',
        KeyConditionExpression: 'cityId = :cityId',
        FilterExpression: 'isActive = :active',
        ExpressionAttributeValues: { ':cityId': city.id, ':active': true },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    items.push(...((result.Items ?? []) as Record<string, unknown>[]))
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  // Map membership is a deliberate split from feature gating (billing R4.3).
  // Feature gating (staff caps, rewards, campaigns, reports) uses Tier_Resolver
  // (getEffectiveTier), which collapses a lapsed paid tier to starter. Map
  // membership instead keys off the STORED tier plus isActive: a venue leaves
  // the consumer map only when storage demotion (deactivateForNonPayment, R3.3)
  // flips it inactive after the grace window lapses. That storage demotion is
  // the single removal mechanism, so we intentionally do not resolve the tier
  // here — doing so would create a second, drifting removal path.
  // Build a map of business-owned nodes whose business is on a paid tier.
  // Only paid-tier venues join the consumer map. Orphan/legacy nodes (no
  // businessId) and free-tier nodes are excluded. Rule recorded in
  // docs/decisions/map-membership.md.
  const businessIds = Array.from(
    new Set(items.map((n) => n['businessId']).filter((b): b is string => typeof b === 'string' && b.length > 0)),
  )
  const paidBusinessTiers = new Map<string, string>()
  if (businessIds.length > 0) {
    const { findBusinessById } = await import('../business/repository.js')
    const businesses = await Promise.all(businessIds.map((id) => findBusinessById(id).catch(() => null)))
    businesses.forEach((b, i) => {
      const tier = b?.tier ?? 'free'
      if (b && PAID_TIERS_SET.has(tier)) {
        paidBusinessTiers.set(businessIds[i]!, tier)
      }
    })
  }

  return items
    .filter((n) => {
      const bid = n['businessId']
      // Require an owning business on a paid tier. Orphan/legacy nodes are hidden.
      if (!bid || typeof bid !== 'string') return false
      return paidBusinessTiers.has(bid)
    })
    .map((n) => ({
      id: n['nodeId'],
      name: n['name'],
      slug: n['slug'],
      category: n['category'],
      lat: n['lat'],
      lng: n['lng'],
      claimStatus: n['claimStatus'],
      nodeColour: n['nodeColour'],
      nodeIcon: n['nodeIcon'],
      isVerified: n['isVerified'],
      headerImageKey: n['headerImageKey'] ?? null,
      socialLinks: normaliseSocialLinks(n['socialLinks']),
      businessTier: paidBusinessTiers.get(n['businessId'] as string) ?? 'starter',
      // Paid Boost_Window, computed at read time (billing R5.2, R5.5). `boostActive`
      // reverts to false on the next read once the window passes — no expiry worker.
      // A paid reach signal only; kept separate from pulse/aliveness (honest-presence).
      boostUntil: (n['boostUntil'] as string | null | undefined) ?? null,
      boostActive: isBoostActive(n['boostUntil'] as string | null | undefined),
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
      new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${node.cityId}`, sk: `CITY#${node.cityId}` } }),
    )
    city = c.Item ? { name: c.Item['name'], slug: c.Item['slug'] } : null
  }
  return {
    ...node,
    id: node.nodeId,
    rewards: rewards.map((r) => ({
      id: r.rewardId,
      title: r.title,
      type: r.type,
      totalSlots: r.totalSlots,
      claimedCount: r.claimedCount,
      expiresAt: r.expiresAt,
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
      new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${node.cityId}`, sk: `CITY#${node.cityId}` } }),
    )
    city = c.Item ? { name: c.Item['name'], slug: c.Item['slug'] } : null
  }
  return {
    name: node.name,
    category: node.category,
    lat: node.lat,
    lng: node.lng,
    city,
    rewards: rewards.map((r) => ({ id: r.rewardId })),
  }
}

export async function searchNodes(query: string, lat: number, lng: number) {
  // Simple text + distance search (replaces PostGIS pg_trgm)
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
    }),
  )
  const q = query.toLowerCase()
  return (result.Items || [])
    .filter((n) => ((n['name'] as string) || '').toLowerCase().includes(q))
    .map((n) => {
      const nLat = n['lat'] as number
      const nLng = n['lng'] as number
      const R = 6371000
      const dLat = ((nLat - lat) * Math.PI) / 180
      const dLng = ((nLng - lng) * Math.PI) / 180
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat * Math.PI) / 180) * Math.cos((nLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return {
        id: n['nodeId'],
        name: n['name'],
        slug: n['slug'],
        category: n['category'],
        lat: nLat,
        lng: nLng,
        similarity: 1,
        distance,
      }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20)
}

export async function createNode(data: {
  name: string
  slug: string
  category: string
  lat: number
  lng: number
  cityId: string
  submittedBy: string
  businessId?: string
  claimStatus?: string
}) {
  return dynamo.createNode(data as unknown as Parameters<typeof dynamo.createNode>[0])
}

export async function updateNode(
  nodeId: string,
  businessId: string,
  data: Partial<{
    name: string
    category: string
    nodeColour: string
    nodeIcon: string
    qrCheckinEnabled: boolean
    lat: number
    lng: number
  }>,
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
        pk: `REPORT#${reportId}`,
        sk: `NODE#${nodeId}`,
        gsi1pk: `NODE_REPORTS#${nodeId}`,
        gsi1sk: new Date().toISOString(),
        reportId,
        reporterId,
        nodeId,
        type,
        detail,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    }),
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
    }),
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
    }),
  )
  return result.Count ?? 0
}

export async function getWhoIsHere(nodeId: string, limit: number) {
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
        userId: user.userId,
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        tier: user.tier,
        checkedInAt: ci.checkedInAt,
      })
    }
    if (items.length >= limit) break
  }
  const hasMore = checkIns.length > limit
  return { items, nextCursor: null, hasMore }
}

export async function getCityBySlug(slug: string) {
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${slug}`, sk: `CITY#${slug}` } }),
  )
  return result.Item ? { id: result.Item['cityId'] ?? slug, slug, name: result.Item['name'] } : null
}
