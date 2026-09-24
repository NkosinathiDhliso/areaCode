import { randomUUID } from 'node:crypto'

import { buildMediaUrl } from '@area-code/shared/lib/mediaUrl'
import type { VenueMomentum, VenueTonight } from '@area-code/shared/types'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { APP_ENV, AWS_REGION, DEV_MODE, mediaCdnBaseUrl, requireEnv, webBaseUrl } from '../../shared/config/env.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvBatchGet, kvGet, kvSet } from '../../shared/kv/dynamodb-kv.js'
import { emitNodeCreated } from '../../shared/socket/events.js'
import { nowEpochSeconds } from '../../shared/time/epoch.js'
import { findBusinessById } from '../business/repository.js'
import {
  getLivePresenceCount,
  getMomentum,
  parsePresenceCounterValue,
  presenceCounterKvKey,
} from '../presence/repository.js'
import { getActiveRewardsByNodeId } from '../rewards/dynamodb-repository.js'

import { isBoostActive } from './boost.js'
import { cityPayloadCacheKey, invalidateCityPayload, invalidateCityPayloadForNode } from './cache.js'
import { DEV_NODES } from './dev-nodes.js'
import * as nodesDynamo from './dynamodb-repository.js'
import { loadGoingCountByNode, readGoingForNode } from './going-service.js'
import { parsePulseScore, pulseKvKey } from './pulse.js'
import * as repo from './repository.js'
import { DEFAULT_OG_IMAGE, type SharePreviewView } from './share-preview.js'
import { buildShareSnapshot } from './share-snapshot.js'
import { loadTonightByBusiness, loadTonightForBusiness } from './tonight-reader.js'

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

// ─── Node Queries ───────────────────────────────────────────────────────────

// Assembled city payload cache: concurrent map loads share one assembly instead
// of each racing the GSI query + pulse batch (R2.3). 45s sits inside the 30-60s
// tolerance the spec accepts; business-tier membership changes take effect
// within the TTL. Live pulse/presence counts keep flowing over the WebSocket,
// so caching the REST seed does not make any live count stale beyond the socket
// path — honest-presence is unaffected (R2.4).
const CITY_PAYLOAD_CACHE_TTL_SECONDS = 45

/**
 * Cached Live_Presence_Count for many venues in ONE batched KV read (R15.6).
 *
 * Used by the dev branch, which has no pulse KV read to batch with; the prod
 * assembly reads the same counter keys inside its single pulse batch so the hot
 * path stays at one round trip. A failing read is logged at error level and
 * yields no counts rather than an invented number (R15.7).
 */
async function readPresenceCounters(nodeIds: string[]): Promise<Map<string, number>> {
  if (nodeIds.length === 0) return new Map()
  try {
    const values = await kvBatchGet(nodeIds.map((id) => presenceCounterKvKey(id)))
    return new Map(nodeIds.map((id) => [id, parsePresenceCounterValue(values.get(presenceCounterKvKey(id)))]))
  } catch (err) {
    console.error(`[nodes] presence counter seed failed for ${nodeIds.length} venues`, err)
    return new Map()
  }
}

async function assembleCityPayload(citySlug: string) {
  const base = await repo.getNodesByCitySlug(citySlug)
  if (base.length === 0) return base

  // Tonight (proof-of-demand R8.5): one schedule read per distinct business,
  // not per node, because the scope is business-wide. An anticipation magnet
  // that works on an empty map: it sits alongside pulse and taste on the card
  // and never substitutes for them (`discovery-dna-vibe-over-convenience.md`).
  const tonightByBusiness = await loadTonightByBusiness(
    base.map((node) => node.businessId),
    new Date().toISOString(),
  )
  const withTonight = base.map((node) => ({
    ...node,
    tonight: tonightByBusiness.get(node.businessId) ?? null,
  }))

  // Going counts (R9.2), read only for the venues whose count the card could
  // ever show: the surfacing rule needs a Tonight, so a venue without one costs
  // no count read at all. Intent sits beside Tonight as its own number and is
  // never folded into pulse, the live count or the order (R9.4).
  const goingByNode = await loadGoingCountByNode(
    withTonight.filter((node) => node.tonight !== null).map((node) => node.id),
  )
  const nodes = withTonight.map((node) => ({
    ...node,
    // `null` means not measured on this payload, never a zero nobody counted.
    goingCount: goingByNode.get(node.id) ?? null,
  }))

  // Aliveness seed for the map's first paint: pulse for the Constellation beams
  // and the honest live presence count for the venue cards, both from ONE
  // batched KV read (BatchGetItem, chunked at 100, UnprocessedKeys retried) —
  // one round trip regardless of venue count (R2.2). No per-node GSI fan-out is
  // added to this hot path (R15.6); the counters read here are the same cached
  // values the realtime `node:presence_update` event carries, so the REST seed
  // and the socket agree, and every per-venue read still resolves the
  // authoritative record-derived count.
  //
  // A missing key means genuinely no pulse and nobody there, not a swallowed
  // error (`honest-presence.md`). A failing read logs at error level with the
  // city slug and returns the unseeded nodes (R15.7): the map still renders, the
  // failure is visible in CloudWatch, and no number is invented.
  try {
    const city = await repo.getCityBySlug(citySlug)
    if (!city) {
      console.error(`[assembleCityPayload] no city row for slug ${citySlug}; serving nodes without an aliveness seed`)
      return nodes
    }
    const values = await kvBatchGet(
      nodes.flatMap((node) => [pulseKvKey(city.id, node.id), presenceCounterKvKey(node.id)]),
    )
    return nodes.map((node) => ({
      ...node,
      pulseScore: parsePulseScore(values.get(pulseKvKey(city.id, node.id))),
      liveCheckInCount: parsePresenceCounterValue(values.get(presenceCounterKvKey(node.id))),
    }))
  } catch (err) {
    console.error(`[assembleCityPayload] aliveness seed failed for city ${citySlug} (${nodes.length} nodes)`, err)
    return nodes
  }
}

export async function getNodesByCitySlug(citySlug: string) {
  if (DEV_MODE) {
    // In dev, surface every mock venue regardless of the requested city slug so
    // the map can be exercised across all provinces and the global sample sites,
    // not only the user's default city. Prod stays city-scoped via the repo.
    void citySlug
    // Live counts come from the same real presence counters prod reads, against
    // dev data (R15.6). The old branch derived a count from the mock pulse
    // score, which meant a dev venue claimed a crowd nobody had checked into.
    const liveCounts = await readPresenceCounters(DEV_NODES.map((n) => n.id))
    return DEV_NODES.map((n) => ({
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
      liveCheckInCount: liveCounts.get(n.id) ?? 0,
    }))
  }

  // Serve the shared assembled payload if it is still warm (R2.3).
  const cacheKey = cityPayloadCacheKey(citySlug)
  const cached = await kvGet(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as Awaited<ReturnType<typeof assembleCityPayload>>
    } catch (err) {
      // A corrupt cache entry must not serve wrong data: treat it as a miss and
      // reassemble from source, logging loudly so the corruption is visible
      // rather than silently masked (no-fallbacks-no-legacy).
      console.error(`[getNodesByCitySlug] corrupt cache entry for ${cacheKey}, reassembling`, err)
    }
  }

  const payload = await assembleCityPayload(citySlug)
  await kvSet(cacheKey, JSON.stringify(payload), CITY_PAYLOAD_CACHE_TTL_SECONDS)
  return payload
}

/**
 * Venue detail. `viewerUserId` is the consumer the request identified, or `null`
 * for an anonymous read: it decides only whether the viewer's own Going state is
 * reported (proof-of-demand R9.2), never what the venue looks like.
 */
export async function getNodeDetail(nodeId: string, viewerUserId: string | null = null) {
  if (DEV_MODE) {
    const node = DEV_NODES.find((n) => n.id === nodeId)
    if (!node) throw AppError.notFound('Node not found')
    return { ...node, pulseScore: node.pulseScore, tonight: null, goingCount: 0 }
  }

  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')

  // Get pulse score from DynamoDB KV
  const cityKey = node.city?.slug
  const pulseScore = cityKey ? parsePulseScore(await kvGet(pulseKvKey(cityKey, nodeId))) : 0

  // Tonight for the detail's Tonight block (R8.5, R8.7). Business-scoped, so it
  // resolves from the owning business's schedule; null when nothing is on.
  const tonight = await loadTonightForBusiness(node.businessId, new Date().toISOString())

  // Going for the same block (R9.2): the true count, plus this viewer's own mark
  // when a token identified them. Intent only, no bearing on pulse or presence.
  const going = await readGoingForNode(nodeId, viewerUserId)

  // Registration evidence is admin-only. The public detail route must never
  // expose it, even though the repository read model carries it for review.
  const publicNode = { ...node }
  delete publicNode.claimRegistrationNumber

  // Expose the paid Boost_Window read model (billing R5.2, R5.5). `boostUntil`
  // flows through the spread; `boostActive` is computed at read time and
  // reverts to false once the window passes, with no expiry worker or residue.
  return { ...publicNode, pulseScore, tonight, ...going, boostActive: isBoostActive(node.boostUntil) }
}

/**
 * Public (unauthenticated) venue read model. Backs
 * `GET /v1/nodes/:nodeSlug/public` and the Share_Preview route, so the two can
 * never drift apart on what a venue looks like to a stranger with a link.
 */
export interface PublicNodeView {
  name: string
  category: string
  city: string | null
  pulseScore: number
  /** Honest Live_Presence_Count: who is there right now (`honest-presence.md`). */
  liveCheckInCount: number
  activeRewardCount: number
  /** Venue header image URL on the Media_CDN, or null when none is set. */
  ogImage: string | null
  /**
   * Tonight summary for the venue's current local night (R8.5), or null when
   * nothing is published. Feeds the Share_Preview snapshot line: a stranger with
   * the link sees the reason to come tonight (R1.2). `VenueTonight` is a
   * superset of the snapshot's own `ShareSnapshotTonight`, so it assigns in.
   */
  tonight: VenueTonight | null
  /**
   * How many consumers marked going for tonight (R9.2). Intent, not presence:
   * it sits beside `liveCheckInCount` and never adds to it, and the surfacing
   * threshold is applied by the surface, not here.
   */
  goingCount: number
}

export async function getNodePublic(nodeSlug: string): Promise<PublicNodeView> {
  if (DEV_MODE) {
    const node = DEV_NODES.find((n) => n.slug === nodeSlug)
    if (!node) throw AppError.notFound('Node not found')
    return {
      name: node.name,
      category: node.category,
      city: node.cityName,
      pulseScore: node.pulseScore,
      liveCheckInCount: node.pulseScore >= 31 ? Math.max(1, Math.round(node.pulseScore / 10)) : 0,
      activeRewardCount: 2,
      ogImage: null,
      tonight: null,
      goingCount: 0,
    }
  }
  const node = await repo.getNodeBySlug(nodeSlug)
  if (!node) throw AppError.notFound('Node not found')

  // Pulse comes from the same KV key `getNodeDetail` reads (R1.4), so the public
  // model and the venue detail can never disagree about how alive a venue is.
  const cityKey = node.city?.slug
  const pulseScore = cityKey ? parsePulseScore(await kvGet(pulseKvKey(cityKey, node.id))) : 0

  // Live count from the authoritative presence read: `present` records that have
  // not expired. Epoch SECONDS, the unit presence records store `expiresAt` in
  // and the unit the check-in write path passes (R15.4). A venue with nobody
  // there reads as zero, honestly (`honest-presence.md`).
  const liveCheckInCount = await getLivePresenceCount(node.id, nowEpochSeconds())

  // Tonight for the share snapshot (R8.5, R1.2). Resolved from the owning
  // business's schedule, the same read the map and the detail use.
  const tonight = await loadTonightForBusiness(node.businessId, new Date().toISOString())

  // Going count from the same read the detail uses, so a stranger with a link and
  // a signed-in consumer never see two different numbers (R9.2). Anonymous, so no
  // viewer state.
  const { goingCount } = await readGoingForNode(node.id, null)

  return {
    name: node.name,
    category: node.category,
    city: node.city?.name ?? null,
    pulseScore,
    liveCheckInCount,
    activeRewardCount: node.rewards.length,
    ogImage: buildMediaUrl(mediaCdnBaseUrl(), node.headerImageKey),
    tonight,
    goingCount,
  }
}

/**
 * Share_Preview view model for `GET /v1/share/node/:slug`
 * (proof-of-demand R1.2, R12.2).
 *
 * Reads the one public venue model and turns it into the document's fields:
 * the snapshot line for `og:description`, the venue header image (or the site
 * default) for `og:image`, and the shared consumer-domain link for `og:url`.
 * Throws `notFound` for an unknown slug, like every other venue read.
 */
export async function getNodeSharePreview(slug: string): Promise<SharePreviewView> {
  const node = await getNodePublic(slug)
  return {
    slug,
    name: node.name,
    description: buildShareSnapshot({
      name: node.name,
      pulseScore: node.pulseScore,
      liveCheckInCount: node.liveCheckInCount,
      activeRewardCount: node.activeRewardCount,
      tonight: node.tonight,
    }),
    imageUrl: node.ogImage ?? DEFAULT_OG_IMAGE,
    canonicalUrl: `${webBaseUrl()}/node/${encodeURIComponent(slug)}`,
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
        area: n.cityName,
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
        pulseScore = parsePulseScore(await kvGet(pulseKvKey(cityId, nodeId)))
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
  // Map membership deliberately keys off the STORED tier, not Tier_Resolver
  // (billing R4.3). Feature gating uses getEffectiveTier (a lapsed paid tier
  // resolves to starter); map membership uses stored state + isActive so the
  // single removal mechanism is storage demotion (deactivateForNonPayment, R3.3)
  // once the grace window lapses. Resolving the tier here would fork a second
  // removal path that could drift from the demotion sweep.
  const business = await findBusinessById(businessId)
  const isPaid = business ? PAID_TIERS.has(business.tier ?? 'free') : false

  // A new venue changes the city payload, so the cached assembly has to go
  // (R15.5). Dropped regardless of tier: a free-tier node is excluded by the
  // membership filter, and the next assembly is the one place that decides.
  await invalidateCityPayload(city.slug)

  if (!isPaid) {
    return node
  }

  // Broadcast to everyone viewing the map for this city so the new node appears instantly
  try {
    await emitNodeCreated(city.slug, {
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

  const created = await repo.createNode({
    name: data.name,
    slug: slugify(data.name),
    category: data.category,
    lat: data.lat,
    lng: data.lng,
    cityId: city.id,
    submittedBy: businessId,
  })
  // New venue in this city: the cached assembly is out of date (R15.5).
  await invalidateCityPayload(city.slug)
  return created
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

  // Name, category, marker colour, icon and position all render on the map, so
  // the cached city assembly has to be dropped or the edit waits out the TTL
  // (R15.5).
  await invalidateCityPayloadForNode(nodeId)
}

export async function updateNodeSocialLinks(
  nodeId: string,
  businessId: string,
  socialLinks: Parameters<typeof repo.replaceNodeSocialLinks>[2],
) {
  const result = await repo.replaceNodeSocialLinks(nodeId, businessId, socialLinks)
  if (result.count === 0) throw AppError.forbidden('You do not own this node')

  if (result.citySlug) {
    await invalidateCityPayload(result.citySlug)
  }
}

// ─── Node Claiming ──────────────────────────────────────────────────────────

export async function claimNode(nodeId: string, businessId: string, registrationNumber: string) {
  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')
  if (node.claimStatus === 'claimed') {
    throw AppError.conflict('Node is already claimed')
  }
  if (node.claimStatus === 'pending') {
    throw AppError.conflict('Claim in progress')
  }

  return repo.claimNode(nodeId, businessId, registrationNumber)
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
      // The flag sets `isActive` false, which takes the venue off the map: same
      // membership change as an admin deactivation, same invalidation (R15.5).
      await invalidateCityPayloadForNode(nodeId)
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
export async function getNodePresence(
  nodeId: string,
): Promise<{ nodeId: string; livePresenceCount: number; momentum: VenueMomentum }> {
  if (DEV_MODE) {
    // No presence table in dev — report 0 / steady honestly rather than
    // substitute a value.
    return { nodeId, livePresenceCount: 0, momentum: 'steady' }
  }
  const now = nowEpochSeconds()
  const livePresenceCount = await getLivePresenceCount(nodeId, now)
  // Seed the honest momentum label on first paint; kept live afterwards by
  // `node:presence_update`. `steady` when there is no recent trend to claim.
  const momentum = await getMomentum(nodeId, now)
  return { nodeId, livePresenceCount, momentum }
}
