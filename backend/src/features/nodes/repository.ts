import { prisma } from '../../shared/db/prisma.js'
import { Prisma } from '@prisma/client'

export async function getNodesByCitySlug(citySlug: string) {
  return prisma.node.findMany({
    where: { city: { slug: citySlug }, isActive: true },
    select: {
      id: true, name: true, slug: true, category: true,
      lat: true, lng: true, claimStatus: true,
      nodeColour: true, nodeIcon: true, isVerified: true,
    },
  })
}

export async function getNodeById(nodeId: string) {
  return prisma.node.findUnique({
    where: { id: nodeId },
    include: {
      rewards: { where: { isActive: true }, select: { id: true, title: true, type: true, totalSlots: true, claimedCount: true, expiresAt: true } },
      city: { select: { name: true, slug: true } },
    },
  })
}

export async function getNodeBySlug(slug: string) {
  return prisma.node.findUnique({
    where: { slug },
    select: {
      name: true, category: true, lat: true, lng: true,
      city: { select: { name: true, slug: true } },
      rewards: { where: { isActive: true }, select: { id: true } },
    },
  })
}

export async function searchNodes(query: string, lat: number, lng: number) {
  return prisma.$queryRaw<
    Array<{
      id: string; name: string; slug: string; category: string;
      lat: number; lng: number; similarity: number; distance: number;
    }>
  >(Prisma.sql`
    SELECT
      n.id, n.name, n.slug, n.category, n.lat, n.lng,
      similarity(n.name, ${query}) AS similarity,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        n.location::geography
      ) AS distance
    FROM nodes n
    WHERE n.is_active = true
      AND similarity(n.name, ${query}) > 0.1
    ORDER BY (similarity(n.name, ${query}) * (1.0 / NULLIF(ST_Distance(
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      n.location::geography
    ), 0))) DESC
    LIMIT 20
  `)
}

export async function createNode(data: {
  name: string; slug: string; category: string;
  lat: number; lng: number; cityId: string; submittedBy: string;
}) {
  return prisma.node.create({ data })
}

export async function updateNode(
  nodeId: string,
  businessId: string,
  data: Partial<{ name: string; category: string; nodeColour: string; nodeIcon: string; qrCheckinEnabled: boolean }>,
) {
  return prisma.node.updateMany({
    where: { id: nodeId, businessId },
    data,
  })
}

export async function claimNode(
  nodeId: string,
  businessId: string,
  cipcStatus: string,
) {
  const claimStatus = cipcStatus === 'validated' ? 'claimed' : 'pending'
  return prisma.node.update({
    where: { id: nodeId },
    data: {
      businessId,
      claimStatus,
      claimCipcStatus: cipcStatus,
    },
  })
}

export async function createReport(
  reporterId: string,
  nodeId: string,
  type: string,
  detail?: string,
) {
  return prisma.report.create({
    data: { reporterId, nodeId, type, detail },
  })
}

export async function countRecentFraudReports(nodeId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return prisma.report.count({
    where: {
      nodeId,
      type: 'fake_rewards',
      createdAt: { gte: since },
    },
  })
}

export async function flagNode(nodeId: string) {
  return prisma.node.update({
    where: { id: nodeId },
    data: { isActive: false },
  })
}

export async function countDismissedReports(reporterId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  return prisma.report.count({
    where: {
      reporterId,
      status: 'dismissed',
      createdAt: { gte: since },
    },
  })
}

export async function getWhoIsHere(nodeId: string, limit: number, cursor?: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000) // Last hour
  const where: Prisma.CheckInWhereInput = {
    nodeId,
    checkedInAt: { gte: since },
    ...(cursor ? { checkedInAt: { gte: since, lt: new Date(cursor) } } : {}),
  }

  const items = await prisma.checkIn.findMany({
    where,
    orderBy: { checkedInAt: 'desc' },
    take: limit + 1,
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true } },
    },
  })

  const hasMore = items.length > limit
  const sliced = hasMore ? items.slice(0, limit) : items
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.checkedInAt.toISOString() : null

  return { items: sliced, nextCursor, hasMore }
}

export async function registerNodeImage(
  nodeId: string,
  s3Key: string,
  uploadedBy: string,
  displayOrder: number,
) {
  return prisma.nodeImage.create({
    data: { nodeId, s3Key, uploadedBy, displayOrder },
  })
}

export async function getCityBySlug(slug: string) {
  return prisma.city.findUnique({ where: { slug } })
}
