// Prisma-backed nodes orchestration. Cross-feature joins (rewards-on-node,
// city-of-node, business-tier-gating, who-is-here) all happen here.

import { prisma } from '../../shared/db/prisma.js'
import * as data from './dynamodb-repository.js'
import { rewardFromPrisma, type RewardDto } from '../../shared/db/adapters.js'
import { batchGetUsers } from '../../shared/db/batch.js'

const PAID_TIERS_SET = new Set(['starter', 'growth', 'pro', 'payg'])

// ─── City lookups ───────────────────────────────────────────────────────────

export async function getCityBySlug(slug: string) {
  const row = await prisma.city.findUnique({ where: { slug } })
  return row ? { id: row.id, slug: row.slug, name: row.name } : null
}

// ─── Node listings ──────────────────────────────────────────────────────────

export async function getNodesByCitySlug(citySlug: string) {
  const city = await getCityBySlug(citySlug)
  if (!city) return []

  // Fetch active nodes in this city + their owning business tier in one trip.
  const rows = await prisma.node.findMany({
    where: { cityId: city.id, isActive: true },
    include: { business: { select: { tier: true } } },
  })

  return rows
    .filter((n) => n.businessId && PAID_TIERS_SET.has(n.business?.tier ?? 'free'))
    .map((n) => ({
      id: n.id,
      name: n.name,
      slug: n.slug,
      category: n.category,
      lat: n.lat,
      lng: n.lng,
      claimStatus: n.claimStatus,
      nodeColour: n.nodeColour,
      nodeIcon: n.nodeIcon,
      isVerified: n.isVerified,
      // boostUntil column may not exist in current schema; expose as null.
      boostUntil: null as string | null,
    }))
}

export async function getNodeById(nodeId: string) {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    include: {
      city: { select: { name: true, slug: true } },
      rewards: { where: { isActive: true } },
    },
  })
  if (!node) return null
  const rewards: RewardDto[] = node.rewards.map(rewardFromPrisma)
  return {
    nodeId: node.id,
    id: node.id,
    name: node.name,
    slug: node.slug,
    category: node.category,
    lat: node.lat,
    lng: node.lng,
    cityId: node.cityId ?? undefined,
    businessId: node.businessId ?? undefined,
    claimStatus: node.claimStatus,
    nodeColour: node.nodeColour,
    nodeIcon: node.nodeIcon,
    qrCheckinEnabled: node.qrCheckinEnabled,
    isVerified: node.isVerified,
    isActive: node.isActive,
    createdAt: node.createdAt.toISOString(),
    rewards: rewards.map((r) => ({
      id: r.rewardId,
      title: r.title,
      type: r.type,
      totalSlots: r.totalSlots,
      claimedCount: r.claimedCount,
      expiresAt: r.expiresAt,
    })),
    city: node.city ? { name: node.city.name, slug: node.city.slug } : null,
  }
}

export async function getNodeBySlug(slug: string) {
  const node = await prisma.node.findUnique({
    where: { slug },
    include: {
      city: { select: { name: true, slug: true } },
      rewards: { where: { isActive: true }, select: { id: true } },
    },
  })
  if (!node) return null
  return {
    name: node.name,
    category: node.category,
    lat: node.lat,
    lng: node.lng,
    city: node.city ? { name: node.city.name, slug: node.city.slug } : null,
    rewards: node.rewards.map((r) => ({ id: r.id })),
  }
}

// ─── Search (trigram + spatial) ─────────────────────────────────────────────

export async function searchNodes(query: string, lat: number, lng: number) {
  return data.searchNodesRaw(query, lat, lng, 20)
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function createNode(input: {
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
  return data.createNode({
    name: input.name,
    slug: input.slug,
    category: input.category,
    lat: input.lat,
    lng: input.lng,
    cityId: input.cityId,
    submittedBy: input.submittedBy,
    businessId: input.businessId,
    claimStatus: input.claimStatus ?? 'unclaimed',
    nodeColour: 'default',
    qrCheckinEnabled: false,
    isVerified: false,
    isActive: true,
  } as Parameters<typeof data.createNode>[0])
}

export async function updateNode(
  nodeId: string,
  businessId: string,
  patch: Partial<{
    name: string
    category: string
    nodeColour: string
    nodeIcon: string
    qrCheckinEnabled: boolean
    lat: number
    lng: number
  }>,
) {
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { businessId: true } })
  if (!node || node.businessId !== businessId) return { count: 0 }
  await data.updateNode(nodeId, patch)
  return { count: 1 }
}

export async function claimNode(nodeId: string, businessId: string, cipcStatus: string) {
  const claimStatus = cipcStatus === 'validated' ? 'claimed' : 'pending'
  return data.updateNode(nodeId, { businessId, claimStatus, claimCipcStatus: cipcStatus })
}

// ─── Reports against nodes ──────────────────────────────────────────────────

export async function createReport(reporterId: string, nodeId: string, type: string, detail?: string) {
  const row = await prisma.report.create({
    data: {
      reporterId,
      nodeId,
      type,
      detail: detail ?? null,
      status: 'pending',
    },
  })
  return {
    id: row.id,
    reporterId: row.reporterId,
    nodeId: row.nodeId,
    type: row.type,
    detail: row.detail ?? undefined,
    status: row.status,
  }
}

export async function countRecentFraudReports(nodeId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return prisma.report.count({
    where: { nodeId, type: 'fake_rewards', createdAt: { gte: since } },
  })
}

export async function flagNode(nodeId: string) {
  return data.updateNode(nodeId, { isActive: false })
}

export async function countDismissedReports(reporterId: string) {
  return prisma.report.count({ where: { reporterId, status: 'dismissed' } })
}

// ─── Who is here (last hour) ────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string, limit: number) {
  const since = new Date(Date.now() - 60 * 60 * 1000)

  // First, distinct users who checked in to this node in the last hour, ordered
  // by their most-recent check-in. We use a window function to grab the latest
  // checked_in_at per user without a self-join.
  const checkIns = await prisma.checkIn.findMany({
    where: { nodeId, checkedInAt: { gte: since } },
    orderBy: { checkedInAt: 'desc' },
    take: (limit + 1) * 4, // generous cap; dedupe in memory
    select: { userId: true, checkedInAt: true },
  })

  const seen = new Set<string>()
  const ordered: Array<{ userId: string; checkedInAt: string }> = []
  for (const c of checkIns) {
    if (seen.has(c.userId)) continue
    seen.add(c.userId)
    ordered.push({ userId: c.userId, checkedInAt: c.checkedInAt.toISOString() })
    if (ordered.length >= limit + 1) break
  }

  const hasMore = ordered.length > limit
  const sliced = hasMore ? ordered.slice(0, limit) : ordered

  const userIds = sliced.map((o) => o.userId)
  const users = await batchGetUsers(userIds)

  const items = sliced
    .map((o) => {
      const u = users[o.userId]
      if (!u) return null
      return {
        userId: u['userId'] as string,
        displayName: u['displayName'] as string,
        username: u['username'] as string,
        avatarUrl: (u['avatarUrl'] as string | null | undefined) ?? null,
        tier: u['tier'] as string,
        checkedInAt: o.checkedInAt,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return { items, nextCursor: null, hasMore }
}

// ─── Node images ────────────────────────────────────────────────────────────

export async function registerNodeImage(
  nodeId: string,
  s3Key: string,
  uploadedBy: string,
  displayOrder: number,
) {
  return data.addNodeImage({ nodeId, s3Key, uploadedBy, displayOrder } as Parameters<
    typeof data.addNodeImage
  >[0])
}
