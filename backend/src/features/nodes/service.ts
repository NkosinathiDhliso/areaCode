import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '../../shared/errors/AppError.js'
import { redis } from '../../shared/redis/client.js'
import { nodesPulse } from '../../shared/redis/keys.js'
import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'

const s3 = new S3Client({ region: process.env['AWS_REGION'] ?? 'af-south-1' })
const BUCKET = process.env['AREA_CODE_S3_MEDIA_BUCKET'] ?? 'area-code-media'
const ENV = process.env['AREA_CODE_ENV'] ?? 'dev'
const DEV_MODE = !isDbAvailable

// ─── Dev Mock Data ──────────────────────────────────────────────────────────

const DEV_NODES = [
  { id: 'dev-1', name: 'Father Coffee', slug: 'father-coffee', category: 'coffee', lat: -26.1834, lng: 28.0172, pulseScore: 8, state: 'quiet', citySlug: 'johannesburg' },
  { id: 'dev-2', name: 'Doubleshot Coffee', slug: 'doubleshot-coffee', category: 'coffee', lat: -26.1838, lng: 28.0168, pulseScore: 0, state: 'dormant', citySlug: 'johannesburg' },
  { id: 'dev-3', name: "Kitchener's Bar", slug: 'kitcheners-bar', category: 'nightlife', lat: -26.1931, lng: 28.0348, pulseScore: 72, state: 'popping', citySlug: 'johannesburg' },
  { id: 'dev-4', name: 'Taboo Nightclub', slug: 'taboo-nightclub', category: 'nightlife', lat: -26.1085, lng: 28.0572, pulseScore: 65, state: 'popping', citySlug: 'johannesburg' },
  { id: 'dev-5', name: 'Sandton City', slug: 'sandton-city', category: 'shopping', lat: -26.1073, lng: 28.052, pulseScore: 18, state: 'active', citySlug: 'johannesburg' },
  { id: 'dev-6', name: 'Arts on Main', slug: 'arts-on-main', category: 'culture', lat: -26.2048, lng: 28.0565, pulseScore: 55, state: 'buzzing', citySlug: 'johannesburg' },
  { id: 'dev-7', name: "Nando's Rosebank", slug: 'nandos-rosebank', category: 'food', lat: -26.14565, lng: 28.04325, pulseScore: 45, state: 'buzzing', citySlug: 'johannesburg' },
  { id: 'dev-8', name: 'Neighbourgoods Market', slug: 'neighbourgoods-market', category: 'food', lat: -26.1925, lng: 28.0335, pulseScore: 25, state: 'active', citySlug: 'johannesburg' },
  { id: 'dev-9', name: 'The Grillhouse', slug: 'the-grillhouse', category: 'food', lat: -26.1468, lng: 28.0418, pulseScore: 38, state: 'buzzing', citySlug: 'johannesburg' },
  { id: 'dev-10', name: 'Virgin Active Sandton', slug: 'virgin-active-sandton', category: 'fitness', lat: -26.1068, lng: 28.0528, pulseScore: 3, state: 'quiet', citySlug: 'johannesburg' },
  { id: 'dev-11', name: 'Planet Fitness Melrose', slug: 'planet-fitness-melrose', category: 'fitness', lat: -26.1345, lng: 28.0685, pulseScore: 5, state: 'quiet', citySlug: 'johannesburg' },
  { id: 'dev-12', name: 'Keyes Art Mile', slug: 'keyes-art-mile', category: 'culture', lat: -26.1492, lng: 28.0408, pulseScore: 12, state: 'active', citySlug: 'johannesburg' },
]

// ─── Node Queries ───────────────────────────────────────────────────────────

export async function getNodesByCitySlug(citySlug: string) {
  if (DEV_MODE) {
    return DEV_NODES.filter((n) => n.citySlug === citySlug)
  }
  return repo.getNodesByCitySlug(citySlug)
}

export async function getNodeDetail(nodeId: string) {
  if (DEV_MODE) {
    const node = DEV_NODES.find((n) => n.id === nodeId)
    if (!node) throw AppError.notFound('Node not found')
    return { ...node, pulseScore: node.pulseScore }
  }

  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')

  // Get pulse score from Redis
  const cityId = node.city?.slug
  let pulseScore = 0
  if (cityId) {
    const score = await redis.zscore(nodesPulse(cityId), nodeId)
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
  if (DEV_MODE) {
    const q = query.toLowerCase()
    return DEV_NODES.filter((n) => n.name.toLowerCase().includes(q))
  }
  return repo.searchNodes(query, lat, lng)
}

// ─── Node CRUD ──────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    + '-' + randomUUID().slice(0, 6)
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
  data: Partial<{ name: string; category: string; nodeColour: string; nodeIcon: string; qrCheckinEnabled: boolean }>,
) {
  const result = await repo.updateNode(nodeId, businessId, data)
  if (result.count === 0) throw AppError.forbidden('You do not own this node')
}

// ─── Node Claiming ──────────────────────────────────────────────────────────

export async function claimNode(
  nodeId: string,
  businessId: string,
  registrationNumber: string,
) {
  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')
  if (node.claimStatus === 'claimed') {
    throw AppError.conflict('Node is already claimed')
  }
  if (node.claimStatus === 'pending') {
    throw AppError.conflict('Claim in progress')
  }

  // CIPC verification — in production, call CIPC API
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

export async function reportNode(
  reporterId: string,
  nodeId: string,
  type: string,
  detail?: string,
) {
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

export async function getWhoIsHere(nodeId: string, limit: number, cursor?: string) {
  return repo.getWhoIsHere(nodeId, limit, cursor)
}

// ─── S3 Presigned Upload ────────────────────────────────────────────────────

const ALLOWED_TYPES = ['image/jpeg', 'image/webp', 'image/png'] as const
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
}

export async function createPresignedUpload(
  ownerId: string,
  fileType: string,
  contentType: string,
) {
  if (!ALLOWED_TYPES.includes(contentType as typeof ALLOWED_TYPES[number])) {
    throw AppError.badRequest('Unsupported content type')
  }

  const ext = EXT_MAP[contentType] ?? 'jpg'
  const s3Key = `${ENV}/${fileType}/${ownerId}/${randomUUID()}.${ext}`

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    ContentType: contentType,
    ContentLength: MAX_SIZE,
  })

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 })

  return { uploadUrl, s3Key, expiresIn: 300 }
}

export async function registerNodeImage(
  nodeId: string,
  businessId: string,
  s3Key: string,
  displayOrder: number,
) {
  // Verify ownership
  const node = await repo.getNodeById(nodeId)
  if (!node || node.businessId !== businessId) {
    throw AppError.forbidden('You do not own this node')
  }

  return repo.registerNodeImage(nodeId, s3Key, businessId, displayOrder)
}
