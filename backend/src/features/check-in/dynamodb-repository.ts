// Prisma-backed check-in data layer. Filename retained until Phase 3 rename.
//
// Heavy use of partitioned `check_ins` table. The composite indexes
// (idx_check_ins_user_time, idx_check_ins_node_time) make all read paths
// here index-only or single-index scans.

import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma.js'
import { checkInFromPrisma } from '../../shared/db/adapters.js'
import type { CheckIn } from './types.js'

// ============================================================================
// CHECK-IN OPERATIONS
// ============================================================================

export async function getCheckInById(checkInId: string): Promise<CheckIn | null> {
  const row = await prisma.checkIn.findUnique({ where: { id: checkInId } })
  return row ? checkInFromPrisma(row) : null
}

export async function createCheckIn(
  data: Omit<CheckIn, 'checkInId' | 'checkedInAt'>,
): Promise<CheckIn> {
  const row = await prisma.checkIn.create({
    data: {
      userId: data.userId,
      nodeId: data.nodeId,
      neighbourhoodId: data.neighbourhoodId ?? null,
      type: data.type ?? 'reward',
    },
  })
  return checkInFromPrisma(row)
}

function decodeCursor(cursor: string | undefined): Date | null {
  if (!cursor) return null
  try {
    return new Date(Buffer.from(cursor, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function encodeCursor(d: Date): string {
  return Buffer.from(d.toISOString()).toString('base64')
}

export async function getCheckInsByUser(
  userId: string,
  options?: { limit?: number; cursor?: string; startTime?: string; endTime?: string },
): Promise<{ checkIns: CheckIn[]; nextCursor?: string }> {
  const limit = options?.limit ?? 50
  const cursorDate = decodeCursor(options?.cursor)

  const where: Record<string, unknown> = { userId }
  const range: Record<string, Date> = {}
  if (options?.startTime) range['gte'] = new Date(options.startTime)
  if (options?.endTime) range['lte'] = new Date(options.endTime)
  if (cursorDate) range['lt'] = cursorDate
  if (Object.keys(range).length > 0) where['checkedInAt'] = range

  const rows = await prisma.checkIn.findMany({
    where,
    orderBy: { checkedInAt: 'desc' },
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore && sliced.length > 0 ? encodeCursor(sliced[sliced.length - 1]!.checkedInAt) : undefined

  return { checkIns: sliced.map(checkInFromPrisma), nextCursor }
}

export async function getCheckInsByNode(
  nodeId: string,
  options?: { limit?: number; cursor?: string; hours?: number },
): Promise<{ checkIns: CheckIn[]; nextCursor?: string }> {
  const limit = options?.limit ?? 50
  const cursorDate = decodeCursor(options?.cursor)

  const where: Record<string, unknown> = { nodeId }
  const range: Record<string, Date> = {}
  if (options?.hours) range['gte'] = new Date(Date.now() - options.hours * 60 * 60 * 1000)
  if (cursorDate) range['lt'] = cursorDate
  if (Object.keys(range).length > 0) where['checkedInAt'] = range

  const rows = await prisma.checkIn.findMany({
    where,
    orderBy: { checkedInAt: 'desc' },
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore && sliced.length > 0 ? encodeCursor(sliced[sliced.length - 1]!.checkedInAt) : undefined

  return { checkIns: sliced.map(checkInFromPrisma), nextCursor }
}

export async function getRecentCheckInCount(
  userId: string,
  nodeId: string,
  hours: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
  return prisma.checkIn.count({ where: { userId, nodeId, checkedInAt: { gte: cutoff } } })
}

export async function getUserCheckInCountAtNode(userId: string, nodeId: string): Promise<number> {
  return prisma.checkIn.count({ where: { userId, nodeId } })
}

export async function getUserCheckInCount(userId: string): Promise<number> {
  return prisma.checkIn.count({ where: { userId } })
}

// ============================================================================
// LEADERBOARD (Postgres fallback — Redis ZSET is the primary path)
// ============================================================================

export async function getLeaderboard(
  cityId: string,
  weekEnding: string,
  limit: number = 100,
): Promise<Array<{ userId: string; rank: number; checkInCount: number }>> {
  const weekEndDate = new Date(weekEnding)
  const weekStartDate = new Date(weekEndDate.getTime() - 7 * 24 * 60 * 60 * 1000)

  // First try the historical archive table (populated by leaderboard-reset worker).
  const history = await prisma.leaderboardHistory.findMany({
    where: { cityId, weekEnding: weekEndDate },
    orderBy: { rank: 'asc' },
    take: limit,
  })
  if (history.length > 0) {
    return history.map((h) => ({ userId: h.userId, rank: h.rank, checkInCount: h.checkInCount }))
  }

  // Otherwise, compute live from check_ins joined with users in this city.
  const rows = await prisma.$queryRaw<Array<{ user_id: string; check_in_count: bigint }>>(Prisma.sql`
    SELECT ci.user_id, COUNT(*)::bigint AS check_in_count
    FROM check_ins ci
    JOIN users u ON u.id = ci.user_id
    WHERE u.city_id = ${cityId}::uuid
      AND ci.checked_in_at >= ${weekStartDate}
      AND ci.checked_in_at < ${weekEndDate}
    GROUP BY ci.user_id
    ORDER BY check_in_count DESC
    LIMIT ${limit}
  `)

  return rows.map((r, i) => ({
    userId: r.user_id,
    rank: i + 1,
    checkInCount: Number(r.check_in_count),
  }))
}

export async function updateLeaderboardEntry(
  cityId: string,
  weekEnding: string,
  userId: string,
  checkInCount: number,
  rank: number,
): Promise<void> {
  const weekEndDate = new Date(weekEnding)
  // Persist to the history archive (idempotent via composite uniqueness pattern;
  // we don't have a unique constraint, so use upsert via deleteMany+create
  // wrapped in a transaction).
  await prisma.$transaction([
    prisma.leaderboardHistory.deleteMany({
      where: { cityId, weekEnding: weekEndDate, userId },
    }),
    prisma.leaderboardHistory.create({
      data: { cityId, weekEnding: weekEndDate, userId, rank, checkInCount },
    }),
  ])
}

// ============================================================================
// ABUSE DETECTION
// ============================================================================

export async function getCheckInVelocity(userId: string, minutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000)
  return prisma.checkIn.count({ where: { userId, checkedInAt: { gte: cutoff } } })
}

export async function markCheckInForDeletion(checkInId: string): Promise<void> {
  // Hard-delete is correct here under Postgres FKs. The "TTL marker" approach
  // was DDB-specific. Cascade rules in the schema take care of dependents.
  await prisma.checkIn.delete({ where: { id: checkInId } }).catch(() => undefined)
}
