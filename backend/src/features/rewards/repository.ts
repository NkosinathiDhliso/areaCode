// DynamoDB-backed Rewards Repository (replaces Prisma)
import { GetCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { kvGet } from '../../shared/kv/dynamodb-kv.js'
import { getStaffById, getUserById } from '../auth/dynamodb-repository.js'
import { findBusinessById } from '../business/repository.js'
import { getEffectiveTier } from '../business/service.js'
import { getNodeById } from '../nodes/dynamodb-repository.js'
import { getLivePresenceCount } from '../presence/repository.js'
import { getFollowingIds, getMutualFollowIds, getFriendsPresence } from '../social/repository.js'

import * as dynamo from './dynamodb-repository.js'
import { classifyLifecycle } from './lifecycle.js'
import { getTasteMatch, rankGetsByVibe, tierMultiplierFor } from './ranking.js'

/** Great-circle distance in metres between two coordinates (haversine). */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Effective-archetype cascade for taste-match (live override → default → eclectic). */
function resolveNodeArchetype(node: {
  currentArchetypeId?: string | null
  defaultArchetypeId?: string | null
}): string {
  return node.currentArchetypeId ?? node.defaultArchetypeId ?? 'archetype-eclectic'
}

/**
 * Count the viewer's friends currently present per node. Best-effort: any lookup
 * failure (presence table absent in some envs, social GSI hiccup) degrades to an
 * empty map so the feed still renders — taste just falls back toward 0.
 */
async function friendsPresentByNode(viewerId: string, nowMs: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  try {
    const followingIds = await getFollowingIds(viewerId)
    const mutualIds = await getMutualFollowIds(viewerId, followingIds)
    const presence = await getFriendsPresence(Array.from(mutualIds), Math.floor(nowMs / 1000))
    for (const p of presence) counts[p.nodeId] = (counts[p.nodeId] ?? 0) + 1
  } catch {
    return {}
  }
  return counts
}

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

export async function getRewardsNearMe(lat: number, lng: number, viewerId?: string) {
  // Scan active rewards, join with nodes, filter by distance (5km)
  const rewardsResult = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.rewards,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
    }),
  )
  const rewards = rewardsResult.Items || []
  const nowMs = Date.now()

  // Viewer taste inputs (best-effort). The viewer's archetype powers the
  // archetype-match term; friends-present powers the friends term. Both degrade
  // to neutral (no match / 0 friends) on any lookup failure so the feed never
  // 500s and simply falls back toward aliveness-first ordering.
  let viewerArchetypeId: string | null = null
  let friendsByNode: Record<string, number> = {}
  if (viewerId) {
    try {
      viewerArchetypeId = (await getUserById(viewerId))?.archetypeId ?? null
    } catch {
      viewerArchetypeId = null
    }
    friendsByNode = await friendsPresentByNode(viewerId, nowMs)
  }

  const candidates = []
  for (const r of rewards) {
    const node = await getNodeById(r['nodeId'] as string)
    if (!node || !node.isActive) continue
    const distance = distanceMeters(lat, lng, node.lat, node.lng)
    if (distance > 5000) continue

    // Honest aliveness signals for the venue behind this get (discovery-DNA:
    // aliveness ranks ABOVE proximity). `liveCount` is the honest CURRENT
    // presence (honest-presence rule); `pulseScore` is the decaying activity
    // score used across the map. Both best-effort: a miss falls back to 0 so a
    // get is never dropped just because its pulse/presence is cold.
    let pulseScore = 0
    if (node.cityId) {
      try {
        const score = await kvGet(`pulse:${node.cityId}:${node.nodeId}`)
        pulseScore = score ? parseFloat(score) : 0
      } catch {
        pulseScore = 0
      }
    }
    let liveCount = 0
    try {
      liveCount = await getLivePresenceCount(node.nodeId, nowMs)
    } catch {
      liveCount = 0
    }

    const getCategory = (r['getCategory'] as 'loyalty' | 'event' | 'offer' | undefined) ?? 'loyalty'
    const startsAt = (r['startsAt'] as string | undefined) ?? null
    const endsAt = (r['endsAt'] as string | undefined) ?? null
    // A live event/offer get marks its venue as "has live gets" (ranking signal 4).
    const isLiveEventOffer =
      (getCategory === 'event' || getCategory === 'offer') &&
      !!startsAt &&
      !!endsAt &&
      classifyLifecycle(startsAt, endsAt, nowMs) === 'live'

    candidates.push({
      id: (r['rewardId'] ?? r['id']) as string,
      title: r['title'],
      type: r['type'],
      total_slots: r['totalSlots'] ?? null,
      claimed_count: r['claimedCount'] ?? 0,
      node_id: node.nodeId,
      node_name: node.name,
      node_slug: node.slug,
      business_id: node.businessId ?? null,
      node_archetype: resolveNodeArchetype(node),
      distance,
      pulse_score: pulseScore,
      live_count: liveCount,
      expires_at: r['expiresAt'] ?? null,
      getCategory,
      startsAt,
      endsAt,
      isLiveEventOffer,
    })
  }

  // Venues with at least one live event/offer get (signal 4). A get inherits its
  // venue's flag, so every get at such a venue is marked.
  const liveGetNodeIds = new Set(candidates.filter((c) => c.isLiveEventOffer).map((c) => c.node_id))

  // Resolve each venue's tier multiplier once per business (signal 3).
  const tierByBusiness = new Map<string, number>()
  async function tierMultiplierForNode(businessId: string | null): Promise<number> {
    if (!businessId) return 1.0
    const cached = tierByBusiness.get(businessId)
    if (cached !== undefined) return cached
    let mult = 1.0
    try {
      const biz = await findBusinessById(businessId)
      mult = tierMultiplierFor(getEffectiveTier((biz as { tier?: string; trialEndsAt?: string | null }) ?? {}))
    } catch {
      mult = 1.0
    }
    tierByBusiness.set(businessId, mult)
    return mult
  }

  const signalled = []
  for (const c of candidates) {
    signalled.push({
      ...c,
      // 1) Taste: archetype match + friends present at the venue.
      tasteMatch: getTasteMatch(viewerArchetypeId, c.node_archetype, friendsByNode[c.node_id] ?? 0),
      // 2) Aliveness: pulse + honest live presence.
      aliveness: (c.pulse_score ?? 0) + (c.live_count ?? 0),
      // 3) Business tier multiplier.
      tierMultiplier: await tierMultiplierForNode(c.business_id),
      // 4) Has live gets at the venue.
      hasLiveGets: liveGetNodeIds.has(c.node_id),
      // 5) Proximity (tiebreaker only).
      distanceMeters: c.distance,
    })
  }

  // Order taste-first to mirror the map carousel (`vibeRank`):
  // taste → aliveness → tier → has-live-gets → proximity → id.
  return rankGetsByVibe(signalled).slice(0, 50)
}

/**
 * Recently claimed gets at venues near the viewer — anonymised social proof for
 * the Gets page ("someone just claimed X at Y"). NEVER reveals who claimed
 * (POPIA / honest-presence): only the get title, venue, distance and recency.
 *
 * Best-effort over a non-hot path: scans recent redemption rows, joins to the
 * reward + node for the venue location, filters by recency and distance.
 */
export async function getRecentClaimsNearMe(lat: number, lng: number, withinMinutes = 180, limit = 15) {
  const cutoffIso = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString()
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND createdAt >= :cutoff',
      ExpressionAttributeValues: { ':prefix': 'REDEMPTION#', ':cutoff': cutoffIso },
    }),
  )
  const rows = (result.Items || []) as Array<Record<string, unknown>>

  // Cache reward → node joins so repeat venues don't re-read.
  const rewardCache = new Map<string, Awaited<ReturnType<typeof getRewardById>>>()
  const claims = []
  for (const row of rows) {
    const rewardId = row['rewardId'] as string | undefined
    if (!rewardId) continue
    let reward = rewardCache.get(rewardId)
    if (reward === undefined) {
      reward = await getRewardById(rewardId)
      rewardCache.set(rewardId, reward)
    }
    if (!reward) continue
    const node = await getNodeById(reward.nodeId)
    if (!node || !node.isActive) continue
    const distance = distanceMeters(lat, lng, node.lat, node.lng)
    if (distance > 5000) continue
    claims.push({
      id: (row['redemptionId'] ?? row['pk']) as string,
      rewardTitle: (row['rewardTitle'] as string) || reward.title,
      nodeId: node.nodeId,
      nodeName: (row['nodeName'] as string) || node.name,
      distance: Math.round(distance),
      claimedAt: (row['createdAt'] as string) ?? cutoffIso,
    })
  }

  return claims.sort((a, b) => b.claimedAt.localeCompare(a.claimedAt)).slice(0, limit)
}

/**
 * The viewer's own claimed-and-redeemed gets — their personal get history.
 * Complements the wallet (which holds active, not-yet-redeemed codes) by listing
 * gets they have already used, newest first.
 */
export async function getClaimedRewards(userId: string, limit = 30) {
  const redemptions = await dynamo.getRedemptionsByUserId(userId)
  const redeemed = redemptions.filter((r) => (r as unknown as Record<string, unknown>)['redeemedAt'])

  const history = []
  for (const rdm of redeemed) {
    const rec = rdm as unknown as Record<string, unknown>
    let rewardTitle = (rec['rewardTitle'] as string) ?? ''
    let nodeName = (rec['nodeName'] as string) ?? ''
    if (!rewardTitle || !nodeName) {
      const reward = rec['rewardId'] ? await dynamo.getRewardById(rec['rewardId'] as string) : null
      if (reward) {
        rewardTitle = rewardTitle || reward.title
        if (!nodeName) {
          const node = await getNodeById(reward.nodeId)
          nodeName = node?.name ?? ''
        }
      }
    }
    history.push({
      id: (rec['redemptionId'] ?? rec['pk']) as string,
      rewardTitle,
      nodeName,
      redeemedAt: rec['redeemedAt'] as string,
    })
  }

  return history.sort((a, b) => (b.redeemedAt ?? '').localeCompare(a.redeemedAt ?? '')).slice(0, limit)
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
