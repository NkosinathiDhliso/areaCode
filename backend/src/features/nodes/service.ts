import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet } from '../../shared/kv/dynamodb-kv.js'
import { getActiveRewardsByNodeId } from '../rewards/dynamodb-repository.js'
import * as repo from './repository.js'
import * as nodesDynamo from './dynamodb-repository.js'
import { findBusinessById } from '../business/repository.js'
import { emitNodeCreated } from '../../shared/socket/events.js'

// Tiers that count as 'paid' — nodes from these businesses appear on the public map.
const PAID_TIERS = new Set(['starter', 'growth', 'pro', 'payg'])

const s3 = new S3Client({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
  // Avoid SDK v3 default of injecting x-amz-checksum-crc32 + x-amz-sdk-checksum-algorithm
  // into presigned PUT URLs — the browser cannot reproduce those headers, causing 403s.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
const BUCKET = process.env['AREA_CODE_S3_MEDIA_BUCKET'] ?? 'area-code-media'
const ENV = process.env['AREA_CODE_ENV'] ?? 'dev'

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
  return repo.getNodesByCitySlug(citySlug)
}

export async function getNodeDetail(nodeId: string) {
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
  const googleApiKey = process.env['GOOGLE_MAPS_API_KEY']

  if (googleApiKey) {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}&region=ZA&components=country:ZA`,
      )
      const data = (await response.json()) as {
        status: string
        results: Array<{ geometry: { location: { lat: number; lng: number } } }>
      }
      if (data.status === 'OK' && data.results[0]) {
        const { lat, lng } = data.results[0].geometry.location
        return { lat, lng }
      }
      // Fall through to OSM on ZERO_RESULTS / REQUEST_DENIED / other non-OK statuses
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

export async function registerNodeImage(nodeId: string, businessId: string, s3Key: string, displayOrder: number) {
  // Verify ownership
  const node = await repo.getNodeById(nodeId)
  if (!node || node.businessId !== businessId) {
    throw AppError.forbidden('You do not own this node')
  }

  return repo.registerNodeImage(nodeId, s3Key, businessId, displayOrder)
}

// ─── Boost ──────────────────────────────────────────────────────────────────

const BOOST_DURATION_MS: Record<string, number> = {
  '2hr': 2 * 60 * 60 * 1000,
  '6hr': 6 * 60 * 60 * 1000,
  '24hr': 24 * 60 * 60 * 1000,
}

export async function activateNodeBoost(nodeId: string, duration: string) {
  const ms = BOOST_DURATION_MS[duration]
  if (!ms) throw AppError.badRequest(`Unknown boost duration: ${duration}`)
  const boostUntil = new Date(Date.now() + ms).toISOString()
  await nodesDynamo.updateNode(nodeId, { boostUntil })
  return { nodeId, boostUntil }
}

// ─── Node Rewards ───────────────────────────────────────────────────────────

export async function getNodeRewards(nodeId: string) {
  const rewards = await getActiveRewardsByNodeId(nodeId)
  return { items: rewards }
}
