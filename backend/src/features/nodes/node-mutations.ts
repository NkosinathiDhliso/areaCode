// Node mutation operations — create, update, claim, report, boost, upload
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import * as nodesDynamo from './dynamodb-repository.js'
import { findBusinessById } from '../business/repository.js'
import { emitNodeCreated } from '../../shared/socket/events.js'

const PAID_TIERS = new Set(['starter', 'growth', 'pro', 'payg'])

const s3 = new S3Client({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
const BUCKET = process.env['AREA_CODE_S3_MEDIA_BUCKET'] ?? 'area-code-media'
const ENV = process.env['AREA_CODE_ENV'] ?? 'dev'

// ─── Helpers ────────────────────────────────────────────────────────────────

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

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
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
    } catch {
      // Fall through to OSM
    }
  }

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

// ─── Node CRUD ──────────────────────────────────────────────────────────────

export async function businessCreateNode(
  businessId: string,
  data: { name: string; category: string; address: string; lat?: number; lng?: number },
) {
  const existingForBiz = await nodesDynamo.getNodesByBusinessId(businessId)
  if (existingForBiz.length > 0) {
    throw AppError.conflict('You already have a venue. Edit your existing venue instead of creating another.')
  }

  let geocoded: { lat: number; lng: number } | null = null
  if (data.lat !== undefined && data.lng !== undefined) {
    geocoded = { lat: data.lat, lng: data.lng }
  } else {
    geocoded = await geocodeAddress(data.address)
  }
  if (!geocoded) throw AppError.badRequest('Could not find address. Please check and try again.')

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

  const business = await findBusinessById(businessId)
  const isPaid = business ? PAID_TIERS.has(business.tier ?? 'free') : false

  if (!isPaid) return node

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
    console.error('[businessCreateNode] emitNodeCreated failed', err)
  }

  return node
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
  }
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

  const cipcStatus = 'validated'
  return repo.claimNode(nodeId, businessId, cipcStatus)
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export async function reportNode(reporterId: string, nodeId: string, type: string, detail?: string) {
  const dismissed = await repo.countDismissedReports(reporterId)
  if (dismissed >= 3) {
    throw AppError.forbidden('Reporting privileges suspended')
  }

  const report = await repo.createReport(reporterId, nodeId, type, detail)

  if (type === 'fake_rewards') {
    const count = await repo.countRecentFraudReports(nodeId)
    if (count >= 5) {
      await repo.flagNode(nodeId)
    }
  }

  return report
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
