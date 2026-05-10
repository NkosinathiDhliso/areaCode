// Prisma-backed nodes data layer. Filename retained until Phase 3 rename.
//
// Spatial queries use PostGIS via $queryRaw with the `location GEOGRAPHY(POINT)`
// generated column and the GIST index `idx_nodes_location` (already in
// 20260330000003_core_tables migration).

import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma.js'
import { nodeFromPrisma, nodeImageFromPrisma } from '../../shared/db/adapters.js'
import { haversineMetres } from '../../shared/db/geohash.js'
import type { Node, NodeImage } from './types.js'

// ============================================================================
// NODE OPERATIONS
// ============================================================================

export async function getNodeById(nodeId: string): Promise<Node | null> {
  const row = await prisma.node.findUnique({ where: { id: nodeId } })
  return row ? nodeFromPrisma(row) : null
}

export async function getNodeBySlug(slug: string): Promise<Node | null> {
  const row = await prisma.node.findUnique({ where: { slug } })
  return row ? nodeFromPrisma(row) : null
}

export async function getNodesByBusinessId(businessId: string): Promise<Node[]> {
  const rows = await prisma.node.findMany({ where: { businessId } })
  return rows.map(nodeFromPrisma)
}

export async function createNode(data: Omit<Node, 'nodeId' | 'createdAt' | 'updatedAt'>): Promise<Node> {
  const row = await prisma.node.create({
    data: {
      name: data.name,
      slug: data.slug,
      category: data.category,
      lat: data.lat,
      lng: data.lng,
      cityId: data.cityId ?? null,
      businessId: data.businessId ?? null,
      submittedBy: data.submittedBy ?? null,
      claimStatus: data.claimStatus ?? 'unclaimed',
      claimCipcStatus: data.claimCipcStatus ?? null,
      nodeColour: data.nodeColour ?? 'default',
      nodeIcon: data.nodeIcon ?? null,
      qrCheckinEnabled: data.qrCheckinEnabled ?? false,
      isVerified: data.isVerified ?? false,
      isActive: data.isActive ?? true,
    },
  })
  return nodeFromPrisma(row)
}

export async function updateNode(
  nodeId: string,
  data: Partial<Omit<Node, 'nodeId' | 'createdAt' | 'updatedAt'>>,
): Promise<Node | null> {
  const update: Record<string, unknown> = {}
  if (data.name !== undefined) update['name'] = data.name
  if (data.category !== undefined) update['category'] = data.category
  if (data.lat !== undefined) update['lat'] = data.lat
  if (data.lng !== undefined) update['lng'] = data.lng
  if (data.cityId !== undefined) update['cityId'] = data.cityId
  if (data.businessId !== undefined) update['businessId'] = data.businessId
  if (data.claimStatus !== undefined) update['claimStatus'] = data.claimStatus
  if (data.claimCipcStatus !== undefined) update['claimCipcStatus'] = data.claimCipcStatus
  if (data.nodeColour !== undefined) update['nodeColour'] = data.nodeColour
  if (data.nodeIcon !== undefined) update['nodeIcon'] = data.nodeIcon
  if (data.qrCheckinEnabled !== undefined) update['qrCheckinEnabled'] = data.qrCheckinEnabled
  if (data.isVerified !== undefined) update['isVerified'] = data.isVerified
  if (data.isActive !== undefined) update['isActive'] = data.isActive

  if (Object.keys(update).length === 0) return getNodeById(nodeId)

  try {
    const row = await prisma.node.update({ where: { id: nodeId }, data: update })
    return nodeFromPrisma(row)
  } catch {
    return null
  }
}

export async function deleteNode(nodeId: string): Promise<void> {
  await prisma.node.delete({ where: { id: nodeId } }).catch(() => undefined)
}

export async function listNodes(options?: {
  cityId?: string
  category?: string
  isActive?: boolean
  limit?: number
  cursor?: string
}): Promise<{ nodes: Node[]; nextCursor?: string }> {
  const where: Record<string, unknown> = {}
  if (options?.cityId) where['cityId'] = options.cityId
  if (options?.category) where['category'] = options.category
  if (options?.isActive !== undefined) where['isActive'] = options.isActive

  const limit = options?.limit ?? 50
  const rows = await prisma.node.findMany({
    where,
    take: limit + 1,
    ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
  })

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore && sliced.length > 0 ? sliced[sliced.length - 1]!.id : undefined

  return { nodes: sliced.map(nodeFromPrisma), nextCursor }
}

// ============================================================================
// NODE IMAGES
// ============================================================================

export async function getNodeImages(nodeId: string): Promise<NodeImage[]> {
  const rows = await prisma.nodeImage.findMany({
    where: { nodeId },
    orderBy: { displayOrder: 'asc' },
  })
  return rows.map(nodeImageFromPrisma)
}

export async function addNodeImage(data: Omit<NodeImage, 'imageId' | 'createdAt'>): Promise<NodeImage> {
  const row = await prisma.nodeImage.create({
    data: {
      nodeId: data.nodeId,
      s3Key: data.s3Key,
      displayOrder: data.displayOrder ?? 0,
      uploadedBy: data.uploadedBy ?? null,
    },
  })
  return nodeImageFromPrisma(row)
}

export async function deleteNodeImage(_nodeId: string, imageId: string): Promise<void> {
  await prisma.nodeImage.delete({ where: { id: imageId } }).catch(() => undefined)
}

// ============================================================================
// NEARBY SEARCH (PostGIS ST_DWithin)
// ============================================================================

interface NearbyRow {
  id: string
  name: string
  slug: string
  category: string
  lat: number
  lng: number
  city_id: string | null
  business_id: string | null
  claim_status: string
  node_colour: string
  node_icon: string | null
  qr_checkin_enabled: boolean
  is_verified: boolean
  is_active: boolean
  created_at: Date
  distance: number
}

export async function findNearbyNodes(
  lat: number,
  lng: number,
  radiusKm: number = 5,
  options?: { category?: string; limit?: number },
): Promise<Node[]> {
  const radiusMetres = radiusKm * 1000
  const limit = options?.limit ?? 20

  // ST_DWithin uses the GIST index `idx_nodes_location` for fast spatial filtering.
  // Returning distance lets us sort nearest-first without an extra round trip.
  const rows = options?.category
    ? await prisma.$queryRaw<NearbyRow[]>(Prisma.sql`
        SELECT id, name, slug, category, lat, lng,
               city_id, business_id, claim_status, node_colour, node_icon,
               qr_checkin_enabled, is_verified, is_active, created_at,
               ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance
        FROM nodes
        WHERE is_active = TRUE
          AND category = ${options.category}
          AND ST_DWithin(
                location,
                ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
                ${radiusMetres}
              )
        ORDER BY distance ASC
        LIMIT ${limit}
      `)
    : await prisma.$queryRaw<NearbyRow[]>(Prisma.sql`
        SELECT id, name, slug, category, lat, lng,
               city_id, business_id, claim_status, node_colour, node_icon,
               qr_checkin_enabled, is_verified, is_active, created_at,
               ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance
        FROM nodes
        WHERE is_active = TRUE
          AND ST_DWithin(
                location,
                ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
                ${radiusMetres}
              )
        ORDER BY distance ASC
        LIMIT ${limit}
      `)

  // The `distance` field is informative but not part of Node DTO; callers that
  // need it use `searchNodes`. Drop it here to keep the contract clean.
  return rows.map((r) => ({
    nodeId: r.id,
    name: r.name,
    slug: r.slug,
    category: r.category,
    lat: r.lat,
    lng: r.lng,
    cityId: r.city_id ?? undefined,
    businessId: r.business_id ?? undefined,
    submittedBy: undefined,
    claimStatus: r.claim_status,
    nodeColour: r.node_colour,
    nodeIcon: r.node_icon ?? undefined,
    qrCheckinEnabled: r.qr_checkin_enabled,
    isVerified: r.is_verified,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.created_at.toISOString(),
  }))
}

// Exported for callers (search) that need similarity + distance together.
export async function searchNodesRaw(
  query: string,
  lat: number,
  lng: number,
  limit = 20,
): Promise<Array<{ id: string; name: string; slug: string; category: string; lat: number; lng: number; similarity: number; distance: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; slug: string; category: string; lat: number; lng: number; similarity: number; distance: number }>
  >(Prisma.sql`
    SELECT id, name, slug, category, lat, lng,
           similarity(name, ${query}) AS similarity,
           ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance
    FROM nodes
    WHERE is_active = TRUE
      AND name % ${query}
    ORDER BY similarity DESC, distance ASC
    LIMIT ${limit}
  `)
  return rows
}

// Re-export for any caller that imported it from the old DDB module.
export { haversineMetres }
