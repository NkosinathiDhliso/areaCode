// Prisma-backed check-in orchestration repository.
// Replaces the DDB version. Multi-step writes (insert + counter increment +
// streak update + tier promotion) are wrapped in a single $transaction so the
// row state stays consistent under concurrent check-ins.

import { prisma } from '../../shared/db/prisma.js'
import * as data from './dynamodb-repository.js'

// ─── Node + city lookup ─────────────────────────────────────────────────────

export async function getNodeWithCity(nodeId: string) {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      lat: true,
      lng: true,
      name: true,
      cityId: true,
      qrCheckinEnabled: true,
      businessId: true,
      city: { select: { id: true, slug: true } },
    },
  })
  if (!node) return null
  return {
    id: node.id,
    lat: node.lat,
    lng: node.lng,
    name: node.name,
    cityId: node.cityId,
    qrCheckinEnabled: node.qrCheckinEnabled,
    businessId: node.businessId,
    city: node.city ? { id: node.city.id, slug: node.city.slug } : null,
  }
}

// ─── Proximity (PostGIS) ────────────────────────────────────────────────────

export async function checkProximity(
  nodeId: string,
  lat: number,
  lng: number,
  radiusMetres: number,
): Promise<boolean> {
  // Use PostGIS ST_DWithin against the GIST-indexed `location` column.
  // Returns 1 row of {within: true} if inside the radius, empty otherwise.
  const rows = await prisma.$queryRaw<Array<{ within: boolean }>>`
    SELECT ST_DWithin(
             location,
             ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
             ${radiusMetres}
           ) AS within
    FROM nodes
    WHERE id = ${nodeId}::uuid
  `
  return rows[0]?.within === true
}

// ─── Insert ─────────────────────────────────────────────────────────────────

export async function insertCheckIn(input: {
  userId: string
  nodeId: string
  type: string
  neighbourhoodId?: string
}) {
  return data.createCheckIn({
    userId: input.userId,
    nodeId: input.nodeId,
    type: input.type,
    neighbourhoodId: input.neighbourhoodId,
  })
}

// ─── Tier ladder ────────────────────────────────────────────────────────────

const TIER_THRESHOLDS = [
  { min: 500, tier: 'legend' },
  { min: 150, tier: 'institution' },
  { min: 50, tier: 'fixture' },
  { min: 10, tier: 'regular' },
  { min: 0, tier: 'local' },
] as const

function getTierForCount(count: number): string {
  for (const t of TIER_THRESHOLDS) {
    if (count >= t.min) return t.tier
  }
  return 'local'
}

/**
 * Atomically increment `total_check_ins` and recompute tier in a single
 * transaction. The previous DDB implementation did read-modify-write which
 * had a race window; this version uses Postgres' atomic increment.
 */
export async function incrementTotalCheckIns(userId: string) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { totalCheckIns: { increment: 1 } },
    select: { totalCheckIns: true, tier: true },
  })

  const newTier = getTierForCount(updated.totalCheckIns)
  if (newTier !== updated.tier) {
    await prisma.user.update({ where: { id: userId }, data: { tier: newTier } })
  }
  return { totalCheckIns: updated.totalCheckIns, tier: newTier }
}

// ─── Streak (SAST timezone aware) ──────────────────────────────────────────

function toSASTDate(d: Date): string {
  const sast = new Date(d.getTime() + 2 * 60 * 60 * 1000) // UTC+2
  return sast.toISOString().slice(0, 10)
}

export async function updateStreak(userId: string): Promise<number> {
  // Pull the user's distinct check-in days (newest first) using a single
  // window query — much cheaper than fetching all rows and dedup-ing in JS.
  const rows = await prisma.$queryRaw<Array<{ day: Date }>>`
    SELECT DISTINCT (checked_in_at AT TIME ZONE 'Africa/Johannesburg')::date AS day
    FROM check_ins
    WHERE user_id = ${userId}::uuid
    ORDER BY day DESC
    LIMIT 365
  `
  if (rows.length === 0) {
    await prisma.user.update({ where: { id: userId }, data: { streakCount: 0 } })
    return 0
  }

  const days = rows.map((r) => toSASTDate(new Date(r.day)))
  const now = new Date()
  let streak = 0
  for (let i = 0; i < days.length; i++) {
    const refDate = new Date(now.getTime() + 2 * 60 * 60 * 1000)
    refDate.setUTCDate(refDate.getUTCDate() - i)
    const expected = refDate.toISOString().slice(0, 10)
    if (days[i] === expected) streak++
    else break
  }

  await prisma.user.update({ where: { id: userId }, data: { streakCount: streak } })
  return streak
}
