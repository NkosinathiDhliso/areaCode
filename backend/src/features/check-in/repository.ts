import { prisma } from '../../shared/db/prisma.js'
import { Prisma } from '@prisma/client'

export async function getNodeWithCity(nodeId: string) {
  return prisma.node.findUnique({
    where: { id: nodeId },
    select: {
      id: true, lat: true, lng: true, name: true,
      cityId: true, qrCheckinEnabled: true, businessId: true,
      city: { select: { id: true, slug: true } },
    },
  })
}

export async function checkProximity(
  nodeId: string, lat: number, lng: number, radiusMetres: number,
): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ within: boolean }>>(
    Prisma.sql`
      SELECT ST_DWithin(
        n.location::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${radiusMetres}
      ) AS within
      FROM nodes n WHERE n.id = ${nodeId}::uuid
    `,
  )
  return result[0]?.within ?? false
}

export async function insertCheckIn(data: {
  userId: string; nodeId: string; type: string; neighbourhoodId?: string;
}) {
  return prisma.checkIn.create({
    data: {
      userId: data.userId,
      nodeId: data.nodeId,
      type: data.type,
      neighbourhoodId: data.neighbourhoodId ?? null,
    },
  })
}

// ─── Tier Recalculation ─────────────────────────────────────────────────────

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

export async function incrementTotalCheckIns(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { totalCheckIns: { increment: 1 } },
    select: { totalCheckIns: true, tier: true },
  })

  const newTier = getTierForCount(user.totalCheckIns)
  if (newTier !== user.tier) {
    await prisma.user.update({
      where: { id: userId },
      data: { tier: newTier },
    })
  }

  return { totalCheckIns: user.totalCheckIns, tier: newTier }
}

// ─── Streak Tracking ────────────────────────────────────────────────────────

function toSASTDate(date: Date): string {
  const sast = new Date(date.getTime() + 2 * 60 * 60 * 1000) // UTC+2
  return sast.toISOString().slice(0, 10)
}

export async function updateStreak(userId: string): Promise<number> {
  // Get the user's last two distinct check-in days (SAST)
  const recent = await prisma.checkIn.findMany({
    where: { userId },
    orderBy: { checkedInAt: 'desc' },
    take: 100,
    select: { checkedInAt: true },
  })

  if (recent.length === 0) return 0

  // Deduplicate by SAST date
  const days = [...new Set(recent.map((c) => toSASTDate(c.checkedInAt)))]
  const today = toSASTDate(new Date())

  // Calculate streak from today backwards
  let streak = 0
  for (let i = 0; i < days.length; i++) {
    const expected = new Date(Date.now() + 2 * 60 * 60 * 1000)
    expected.setUTCDate(expected.getUTCDate() - i)
    const expectedDate = expected.toISOString().slice(0, 10)
    if (days[i] === expectedDate) {
      streak++
    } else {
      break
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { streakCount: streak },
  })

  return streak
}
