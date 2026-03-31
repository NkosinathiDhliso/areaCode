import { prisma } from '../../shared/db/prisma.js'
import { redis } from '../../shared/redis/client.js'
import { leaderboard } from '../../shared/redis/keys.js'
import { Prisma } from '@prisma/client'

// ─── Follows ────────────────────────────────────────────────────────────────

export async function followUser(followerId: string, followingId: string) {
  return prisma.userFollow.create({
    data: { followerId, followingId },
  })
}

export async function unfollowUser(followerId: string, followingId: string) {
  return prisma.userFollow.deleteMany({
    where: { followerId, followingId },
  })
}

export async function isFollowing(followerId: string, followingId: string) {
  const count = await prisma.userFollow.count({
    where: { followerId, followingId },
  })
  return count > 0
}

// ─── Activity Feed ──────────────────────────────────────────────────────────

export async function getActivityFeed(
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  const where: Prisma.CheckInWhereInput = {
    user: {
      followers: { some: { followerId: userId } },
    },
    ...(cursor ? { checkedInAt: { lt: new Date(cursor) } } : {}),
  }

  const items = await prisma.checkIn.findMany({
    where,
    orderBy: { checkedInAt: 'desc' },
    take: limit + 1,
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true } },
      node: { select: { id: true, name: true, slug: true, category: true } },
    },
  })

  const hasMore = items.length > limit
  const sliced = hasMore ? items.slice(0, limit) : items
  const nextCursor = hasMore
    ? sliced[sliced.length - 1]?.checkedInAt.toISOString()
    : null

  return { items: sliced, nextCursor, hasMore }
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(
  lat: number,
  lng: number,
  radiusMetres: number,
  withinMinutes: number,
) {
  const since = new Date(Date.now() - withinMinutes * 60 * 1000)

  const results = await prisma.$queryRaw<
    Array<{
      username: string
      node_name: string
      distance_metres: number
      checked_in_at: Date
    }>
  >(Prisma.sql`
    SELECT
      u.username,
      n.name AS node_name,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        n.location::geography
      ) AS distance_metres,
      ci.checked_in_at
    FROM check_ins ci
    JOIN users u ON u.id = ci.user_id
    JOIN nodes n ON n.id = ci.node_id
    JOIN consent_records cr ON cr.user_id = u.id
    WHERE ci.checked_in_at > ${since}
      AND cr.broadcast_location = true
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        n.location::geography,
        ${radiusMetres}
      )
      AND cr.id = (
        SELECT id FROM consent_records
        WHERE user_id = u.id
        ORDER BY consented_at DESC LIMIT 1
      )
    ORDER BY ci.checked_in_at DESC
    LIMIT 1
  `)

  if (results.length === 0) return null

  const row = results[0]!
  const minutesAgo = Math.round(
    (Date.now() - new Date(row.checked_in_at).getTime()) / 60000,
  )

  return {
    username: row.username,
    nodeName: row.node_name,
    distanceMetres: Math.round(row.distance_metres),
    minutesAgo,
  }
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export async function getCityBySlug(slug: string) {
  return prisma.city.findUnique({ where: { slug } })
}

export async function getLeaderboardTop50(cityId: string) {
  const key = leaderboard(cityId)
  const raw = await redis.zrevrange(key, 0, 49, 'WITHSCORES')

  const entries: Array<{ userId: string; checkInCount: number; rank: number }> = []
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      userId: raw[i]!,
      checkInCount: parseInt(raw[i + 1]!, 10),
      rank: Math.floor(i / 2) + 1,
    })
  }
  return entries
}

export async function getUserLeaderboardRank(cityId: string, userId: string) {
  const key = leaderboard(cityId)
  const [rank, score] = await Promise.all([
    redis.zrevrank(key, userId),
    redis.zscore(key, userId),
  ])

  if (rank === null || score === null) return null
  return { rank: rank + 1, checkInCount: parseInt(score, 10) }
}

export async function getUserProfiles(userIds: string[]) {
  if (userIds.length === 0) return []
  return prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      tier: true,
    },
  })
}
