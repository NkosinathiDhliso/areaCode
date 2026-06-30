import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '../../shared/errors/AppError.js'
import { APP_ENV, AWS_REGION, DEV_MODE, requireEnv } from '../../shared/config/env.js'
import { kvGet } from '../../shared/kv/dynamodb-kv.js'
import { getActiveRewardsByNodeId } from '../rewards/dynamodb-repository.js'
import * as repo from './repository.js'
import * as nodesDynamo from './dynamodb-repository.js'
import { findBusinessById } from '../business/repository.js'
import { emitNodeCreated } from '../../shared/socket/events.js'
import { getLivePresenceCount } from '../presence/repository.js'

// Tiers that count as 'paid' — nodes from these businesses appear on the public map.
const PAID_TIERS = new Set(['starter', 'growth', 'pro', 'payg'])

const s3 = new S3Client({
  region: AWS_REGION,
  // Avoid SDK v3 default of injecting x-amz-checksum-crc32 + x-amz-sdk-checksum-algorithm
  // into presigned PUT URLs — the browser cannot reproduce those headers, causing 403s.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
const BUCKET = requireEnv('AREA_CODE_S3_MEDIA_BUCKET', 'area-code-dev-media')
const ENV = APP_ENV

// ─── State Thresholds ───────────────────────────────────────────────────────

const STATE_THRESHOLDS = [
  { min: 61, state: 'popping' as const },
  { min: 31, state: 'buzzing' as const },
  { min: 11, state: 'active' as const },
  { min: 1, state: 'quiet' as const },
  { min: 0, state: 'dormant' as const },
]

function getNodeState(score: number): string {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}

// ─── Dev Mock Data ──────────────────────────────────────────────────────────

const DEV_NODES = [
  {
    id: 'dev-1',
    name: 'Father Coffee',
    slug: 'father-coffee',
    category: 'coffee',
    lat: -26.1834,
    lng: 28.0172,
    pulseScore: 8,
    state: 'quiet',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-2',
    name: 'Doubleshot Coffee',
    slug: 'doubleshot-coffee',
    category: 'coffee',
    lat: -26.1838,
    lng: 28.0168,
    pulseScore: 0,
    state: 'dormant',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-3',
    name: "Kitchener's Bar",
    slug: 'kitcheners-bar',
    category: 'nightlife',
    lat: -26.1931,
    lng: 28.0348,
    pulseScore: 72,
    state: 'popping',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-4',
    name: 'Taboo Nightclub',
    slug: 'taboo-nightclub',
    category: 'nightlife',
    lat: -26.1085,
    lng: 28.0572,
    pulseScore: 65,
    state: 'popping',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-5',
    name: 'Sandton City',
    slug: 'sandton-city',
    category: 'shopping',
    lat: -26.1073,
    lng: 28.052,
    pulseScore: 18,
    state: 'active',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-6',
    name: 'Arts on Main',
    slug: 'arts-on-main',
    category: 'culture',
    lat: -26.2048,
    lng: 28.0565,
    pulseScore: 55,
    state: 'buzzing',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-7',
    name: "Nando's Rosebank",
    slug: 'nandos-rosebank',
    category: 'food',
    lat: -26.14565,
    lng: 28.04325,
    pulseScore: 45,
    state: 'buzzing',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-8',
    name: 'Neighbourgoods Market',
    slug: 'neighbourgoods-market',
    category: 'food',
    lat: -26.1925,
    lng: 28.0335,
    pulseScore: 25,
    state: 'active',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-9',
    name: 'The Grillhouse',
    slug: 'the-grillhouse',
    category: 'food',
    lat: -26.1468,
    lng: 28.0418,
    pulseScore: 38,
    state: 'buzzing',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-10',
    name: 'Virgin Active Sandton',
    slug: 'virgin-active-sandton',
    category: 'fitness',
    lat: -26.1068,
    lng: 28.0528,
    pulseScore: 3,
    state: 'quiet',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-11',
    name: 'Planet Fitness Melrose',
    slug: 'planet-fitness-melrose',
    category: 'fitness',
    lat: -26.1345,
    lng: 28.0685,
    pulseScore: 5,
    state: 'quiet',
    citySlug: 'johannesburg',
  },
  {
    id: 'dev-12',
    name: 'Keyes Art Mile',
    slug: 'keyes-art-mile',
    category: 'culture',
    lat: -26.1492,
    lng: 28.0408,
    pulseScore: 12,
    state: 'active',
    citySlug: 'johannesburg',
  },
]

// ─── Node Queries ───────────────────────────────────────────────────────────

export async function getNodesByCitySlug(citySlug: string) {
  if (DEV_MODE) {
    return DEV_NODES.filter((n) => n.citySlug === citySlug).map((n) => ({
      id: n.id,
      name: n.name,
      slug: n.slug,
      category: n.category,
      lat: n.lat,
      lng: n.lng,
      claimStatus: 'claimed' as const,
      nodeColour: '#888',
      nodeIcon: null,
      isVerified: true,
      businessTier: 'starter' as const,
      pulseScore: n.pulseScore,
      liveCheckInCount: n.pulseScore >= 31 ? Math.max(1, Math.round(n.pulseScore / 10)) : 0,
    }))
  }

  const nodes = await repo.getNodesByCitySlug(citySlug)
  if (nodes.length === 0) return nodes

  // Best-effort pulse seed for Constellation beams on first paint. This must
  // NEVER break the map: any KV failure falls back to a base node (pulseScore
  // 0) and the beam lights up once the live socket pulse arrives. We only read
  // the cheap pulse KV here - live presence counts come over the WebSocket, so
  // we deliberately avoid a per-node GSI fan-out on this hot read path.
  try {
    const city = await repo.getCityBySlug(citySlug)
    if (!city) return nodes
    return await Promise.all(
      nodes.map(async (node) => {
        try {
          const scoreStr = await kvGet(`pulse:${city.id}:${node.id}`)
          return { ...node, pulseScore: scoreStr ? parseFloat(scoreStr) : 0 }
        } catch {
          return { ...node, pulseScore: 0 }
        }
      }),
    )
  } catch {
    return nodes
  }
}

export async function getNodeDetail(nodeId: string) {
  if (DEV_MODE) {
    const node = DEV_NODES.find((n) => n.id === nodeId)
    if (!node) throw AppError.notFound('Node not found')
    return { ...node, pulseScore: node.pulseScore }
  }

  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')

  // Get pulse score from DynamoDB KV
  const cityId = node.city?.slug
  let pulseScore = 0
  if (cityId) {
    const score = await kvGet(`pulse:${cityId}:${nodeId}`)
    pulseScore = score ? parseFloat(score) : 0
  }

  return { ...node, pulseScore }
}

export async function getNodePublic(nodeSlug: string) {
  if (DEV_MODE) {
    const node = DEV_NODES.find((n) => n.slug === nodeSlug)
    if (!node) throw AppError.notFound('Node not found')
    return {
      name: node.name,
      category: node.category,
      city: 'Johannesburg',
      pulseScore: node.pulseScore,
      activeRewardCount: 2,
      ogImage: null,
    }
  }
  const node = await repo.getNodeBySlug(nodeSlug)
  if (!node) throw AppError.notFound('Node not found')

  return {
    name: node.name,
    category: node.category,
    city: node.city?.name ?? null,
    pulseScore: 0,
    activeRewardCount: node.rewards.length,
    ogImage: null,
  }
}

export async function searchNodes(query: string, lat: number, lng: number) {
  if (query.length < 2) throw AppError.badRequest('Query must be at least 2 characters')
  if (DEV_MODE) {
    const q = query.toLowerCase()
    return DEV_NODES.filter((n) => n.name.toLowerCase().includes(q))
  }
  return repo.searchNodes(query, lat, lng)
}

// ─── Trending Nodes ─────────────────────────────────────────────────────────

interface TrendingItem {
  name: string
  area: string
  state: string
  checkIns: number
  nodeId: string
  slug: string
  category: string
  lat: number
  lng: number
}

const CITY_SLUGS = ['johannesburg', 'cape-town', 'durban']

export async function getTrendingNodes(limit = 10): Promise<{ items: TrendingItem[] }> {
  if (DEV_MODE) {
    // Sort dev nodes by pulseScore descending and return top N
    const sorted = [...DEV_NODES]
      .filter((n) => n.pulseScore > 0)
      .sort((a, b) => b.pulseScore - a.pulseScore)
      .slice(0, limit)

    return {
      items: sorted.map((n) => ({
        name: n.name,
        area: 'Johannesburg',
        state: getNodeState(n.pulseScore),
        checkIns: Math.ceil(n.pulseScore / 5),
        nodeId: n.id,
        slug: n.slug,
        category: n.category,
        lat: n.lat,
        lng: n.lng,
      })),
    }
  }

  // Fetch nodes from all cities in parallel
  const cityResults = await Promise.all(
    CITY_SLUGS.map(async (slug) => {
      const city = await repo.getCityBySlug(slug)
      if (!city) return []
      const nodes = await repo.getNodesByCitySlug(slug)
      return nodes.map((n: Record<string, unknown>) => ({
        ...n,
        cityName: city.name,
        cityId: city.id,
      }))
    }),
  )

  const allNodes = cityResults.flat()

  // Fetch pulse scores for all nodes in parallel
  const scored = await Promise.all(
    allNodes.map(async (node: Record<string, unknown>) => {
      const nodeId = (node['id'] ?? node['nodeId']) as string
      const cityId = node['cityId'] as string
      let pulseScore = 0
      try {
        const score = await kvGet(`pulse:${cityId}:${nodeId}`)
        pulseScore = score ? parseFloat(score) : 0
      } catch {
        // KV lookup failed, default to 0
      }
      return { node, pulseScore }
    }),
  )

  // Sort by pulse score descending, take top N with score > 0
  const trending = scored
    .filter((s) => s.pulseScore > 0)
    .sort((a, b) => b.pulseScore - a.pulseScore)
    .slice(0, limit)

  return {
    items: trending.map((s) => ({
      name: s.node['name'] as string,
      area: s.node['cityName'] as string,
      state: getNodeState(s.pulseScore),
      checkIns: Math.ceil(s.pulseScore / 5),
      nodeId: (s.node['id'] ?? s.node['nodeId']) as string,
      slug: (s.node['slug'] ?? '') as string,
      category: (s.node['category'] ?? 'default') as string,
      lat: (s.node['lat'] ?? 0) as number,
      lng: (s.node['lng'] ?? 0) as number,
    })),
  }
}

// ─── Node CRUD ──────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
    '-' +
    randomUUID().slice(0, 6)
  )
}

export async function businessCreateNode(
  businessId: string,
  data: { name: string; category: string; address: string; lat?: number; lng?: number },
) {
  if (DEV_MODE) {
    const id = `dev-${Date.now()}`
    return {
      id,
      name: data.name,
      slug: slugify(data.name),
      category: data.category,
      lat: data.lat ?? -26.2041,
      lng: data.lng ?? 28.0473,
      citySlug: 'johannesburg',
    }
  }
  // Enforce one-node-per-business: reject if this business already owns a node.
  const existingForBiz = await nodesDynamo.getNodesByBusinessId(businessId)
  if (existingForBiz.length > 0) {
    throw AppError.conflict('You already have a venue. Edit your existing venue instead of creating another.')
  }

  // Use coordinates from Google Places if provided, otherwise geocode the address
  let geocoded: { lat: number; lng: number } | null = null
  if (data.lat !== undefined && data.lng !== undefined) {
    geocoded = { lat: data.lat, lng: data.lng }
  } else {
    geocoded = await geocodeAddress(data.address)
  }
  if (!geocoded) throw AppError.badRequest('Could not find address. Please check and try again.')

  // Get default city (Johannesburg for SA)
  const city = await repo.getCityBySlug('johannesburg')
  if (!city) throw AppError.badRequest('City not found')

  const node = await repo.createNode({
    name: data.name,
    slug: slugify(data.name),
    category: data.category,
    lat: geocoded.lat,
    lng: geocoded.lng,
    cityId: city.id,
    businessId,
    submittedBy: businessId,
    claimStatus: 'claimed',
  })

  // Only broadcast (and surface on the public map) if the business is on a paid tier.
  const business = await findBusinessById(businessId)
  const isPaid = business ? PAID_TIERS.has(business.tier ?? 'free') : false

  if (!isPaid) {
    return node
  }

  // Broadcast to everyone viewing the map for this city so the new node appears instantly
  try {
    emitNodeCreated(city.slug, {
      id: node.nodeId,
      name: node.name,
      slug: node.slug,
      category: node.category,
      lat: node.lat,
      lng: node.lng,
      claimStatus: 'claimed',
      nodeColour: 'default',
      isVerified: false,
    })
  } catch (err) {
    // Socket emit failure must not fail the node creation itself
    console.error('[businessCreateNode] emitNodeCreated failed', err)
  }

  return node
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const mapboxToken = process.env['MAPBOX_TOKEN'] ?? process.env['VITE_MAPBOX_TOKEN']

  if (mapboxToken) {
    try {
      const response = await fetch(
        `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(address)}` +
          `&country=za&limit=1&access_token=${mapboxToken}`,
      )
      const data = (await response.json()) as {
        features?: Array<{ properties?: { coordinates?: { longitude?: number; latitude?: number } } }>
      }
      const coords = data.features?.[0]?.properties?.coordinates
      if (coords?.latitude !== undefined && coords?.longitude !== undefined) {
        return { lat: coords.latitude, lng: coords.longitude }
      }
      // Fall through to OSM if Mapbox returns no usable feature
    } catch {
      // Fall through to OSM on network error
    }
  }

  // Fallback: OpenStreetMap Nominatim (free, no key)
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycode=za`,
      { headers: { 'User-Agent': 'AreaCode/1.0' } },
    )
    const results = (await response.json()) as Array<{ lat: string; lon: string }>
    if (results?.[0]) {
      return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) }
    }
    return null
  } catch {
    return null
  }
}

export async function createNode(
  businessId: string,
  data: { name: string; category: string; lat: number; lng: number; citySlug: string },
) {
  if (DEV_MODE) {
    const id = `dev-${Date.now()}`
    return {
      id,
      name: data.name,
      slug: slugify(data.name),
      category: data.category,
      lat: data.lat,
      lng: data.lng,
      citySlug: data.citySlug,
    }
  }
  const city = await repo.getCityBySlug(data.citySlug)
  if (!city) throw AppError.badRequest('Invalid city')

  return repo.createNode({
    name: data.name,
    slug: slugify(data.name),
    category: data.category,
    lat: data.lat,
    lng: data.lng,
    cityId: city.id,
    submittedBy: businessId,
  })
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
    address: string
    lat: number
    lng: number
  }>,
) {
  if (DEV_MODE) return

  // If address is provided, re-geocode (unless coords already supplied from Places autocomplete)
  const patch: Record<string, unknown> = { ...data }
  if (data.address) {
    let geo: { lat: number; lng: number } | null = null
    if (data.lat !== undefined && data.lng !== undefined) {
      geo = { lat: data.lat, lng: data.lng }
    } else {
      geo = await geocodeAddress(data.address)
    }
    if (!geo) throw AppError.badRequest('Could not find address. Please check and try again.')
    patch['lat'] = geo.lat
    patch['lng'] = geo.lng
    // address itself is not stored on the node record; only lat/lng + derived name
  }
  // Strip address from the DB patch (it's not a column on nodes)
  delete patch['address']

  const result = await repo.updateNode(nodeId, businessId, patch as Parameters<typeof repo.updateNode>[2])
  if (result.count === 0) throw AppError.forbidden('You do not own this node')
}

// ─── Node Claiming ──────────────────────────────────────────────────────────

export async function claimNode(nodeId: string, businessId: string, registrationNumber: string) {
  void registrationNumber
  if (DEV_MODE) {
    return { nodeId, businessId, claimStatus: 'validated' }
  }
  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')
  if (node.claimStatus === 'claimed') {
    throw AppError.conflict('Node is already claimed')
  }
  if (node.claimStatus === 'pending') {
    throw AppError.conflict('Claim in progress')
  }

  // CIPC verification , in production, call CIPC API
  // For now, simulate validation
  let cipcStatus: string
  const cipcAvailable = true // Would be actual API call

  if (cipcAvailable) {
    // Simulate name match check
    cipcStatus = 'validated'
  } else {
    cipcStatus = 'cipc_unavailable'
  }

  return repo.claimNode(nodeId, businessId, cipcStatus)
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export async function reportNode(reporterId: string, nodeId: string, type: string, detail?: string) {
  if (DEV_MODE) {
    return { id: `report-${Date.now()}`, reporterId, nodeId, type, detail, status: 'pending' }
  }
  // Check if reporter is banned (3 dismissed reports in 30 days)
  const dismissed = await repo.countDismissedReports(reporterId)
  if (dismissed >= 3) {
    throw AppError.forbidden('Reporting privileges suspended')
  }

  const report = await repo.createReport(reporterId, nodeId, type, detail)

  // Auto-flag on 5+ fraud reports in 24h
  if (type === 'fake_rewards') {
    const count = await repo.countRecentFraudReports(nodeId)
    if (count >= 5) {
      await repo.flagNode(nodeId)
    }
  }

  return report
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string, limit: number) {
  if (DEV_MODE) {
    return {
      items: [
        {
          userId: 'dev-user-2',
          username: 'sipho_jozi',
          displayName: 'Sipho',
          avatarUrl: null,
          tier: 'trailblazer',
          checkedInAt: new Date(Date.now() - 120000).toISOString(),
        },
        {
          userId: 'dev-user-3',
          username: 'thandi_sa',
          displayName: 'Thandi',
          avatarUrl: null,
          tier: 'explorer',
          checkedInAt: new Date(Date.now() - 300000).toISOString(),
        },
      ],
      nextCursor: null,
      hasMore: false,
    }
  }
  return repo.getWhoIsHere(nodeId, limit)
}

// ─── S3 Presigned Upload ────────────────────────────────────────────────────

const ALLOWED_TYPES = ['image/jpeg', 'image/webp', 'image/png'] as const
const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
}

export async function createPresignedUpload(ownerId: string, fileType: string, contentType: string) {
  if (!ALLOWED_TYPES.includes(contentType as (typeof ALLOWED_TYPES)[number])) {
    throw AppError.badRequest('Unsupported content type')
  }

  const ext = EXT_MAP[contentType] ?? 'jpg'
  const s3Key = `${ENV}/${fileType}/${ownerId}/${randomUUID()}.${ext}`

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 })

  return { uploadUrl, s3Key, expiresIn: 300 }
}

// ─── Node Rewards ───────────────────────────────────────────────────────────

export async function getNodeRewards(nodeId: string) {
  if (DEV_MODE) {
    return { items: [] }
  }
  const rewards = await getActiveRewardsByNodeId(nodeId)
  return { items: rewards }
}

// ─── Honest Presence Read Model ─────────────────────────────────────────────

/**
 * Honest Live_Presence_Count for a venue (Requirements 7.1, 7.6, 7.7, 6.4).
 *
 * The count is computed directly from the presence records via the `NodeIndex`
 * query (`present` records with `expiresAt > now`) — it NEVER trusts the cached
 * counter over the record query, excludes expired-but-unswept records, and
 * returns 0 honestly with no decayed or historical substitution.
 */
export async function getNodePresence(nodeId: string): Promise<{ nodeId: string; livePresenceCount: number }> {
  if (DEV_MODE) {
    // No presence table in dev — report 0 honestly rather than substitute a value.
    return { nodeId, livePresenceCount: 0 }
  }
  const now = Math.floor(Date.now() / 1000)
  const livePresenceCount = await getLivePresenceCount(nodeId, now)
  return { nodeId, livePresenceCount }
}
