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

/**
 * Given a viewer and a list of candidate user IDs, returns the subset
 * that are mutual follows of the viewer.
 *
 * Uses a single query with a self-join on user_follows.
 * Returns empty set on empty input or DB errors (safe fallback).
 */
export async function getMutualFollowIds(
  viewerId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set()

  try {
    const rows = await prisma.$queryRaw<Array<{ following_id: string }>>(
      Prisma.sql`
        SELECT uf1.following_id
        FROM user_follows uf1
        JOIN user_follows uf2
          ON uf1.following_id = uf2.follower_id
          AND uf2.following_id = uf1.follower_id
        WHERE uf1.follower_id = ${viewerId}::uuid
          AND uf1.following_id IN (${Prisma.join(candidateIds.map(id => Prisma.sql`${id}::uuid`))})
      `,
    )

    return new Set(rows.map(r => r.following_id))
  } catch {
    return new Set()
  }
}

export async function getFollowingIds(userId: string): Promise<string[]> {
  const rows = await prisma.userFollow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  })
  return rows.map(r => r.followingId)
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
      following: { some: { followingId: userId } },
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
      node_name: string
      distance_metres: number
      checked_in_at: Date
    }>
  >(Prisma.sql`
    SELECT
      n.name AS node_name,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        n.location::geography
      ) AS distance_metres,
      ci.checked_in_at
    FROM check_ins ci
    JOIN nodes n ON n.id = ci.node_id
    WHERE ci.checked_in_at > ${since}
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        n.location::geography,
        ${radiusMetres}
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
    nodeName: row.node_name,
    distanceMetres: Math.round(row.distance_metres),
    minutesAgo,
  }
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000) // last hour

  const checkIns = await prisma.checkIn.findMany({
    where: { nodeId, checkedInAt: { gte: since } },
    orderBy: { checkedInAt: 'desc' },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true } },
    },
    distinct: ['userId'],
  })

  return checkIns.map((ci) => ({
    userId: ci.user.id,
    displayName: ci.user.displayName,
    username: ci.user.username,
    avatarUrl: ci.user.avatarUrl,
    tier: ci.user.tier,
    checkedInAt: ci.checkedInAt.toISOString(),
  }))
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

// ─── Friends / Following / Followers ────────────────────────────────────────

export async function getMutualFriends(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string; username: string; display_name: string; avatar_url: string | null; tier: string; total_check_ins: number }>>(
    Prisma.sql`
      SELECT u.id, u.username, u.display_name, u.avatar_url, u.tier, u.total_check_ins
      FROM user_follows uf1
      JOIN user_follows uf2
        ON uf1.following_id = uf2.follower_id
        AND uf2.following_id = uf1.follower_id
      JOIN users u ON u.id = uf1.following_id
      WHERE uf1.follower_id = ${userId}::uuid
      ORDER BY u.display_name
    `,
  )
  return rows.map((r) => ({
    userId: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    tier: r.tier,
    totalCheckIns: r.total_check_ins,
  }))
}

export async function getFollowingList(userId: string) {
  const follows = await prisma.userFollow.findMany({
    where: { followerId: userId },
    include: {
      following: {
        select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true, totalCheckIns: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const followingIds = follows.map((f) => f.followingId)
  const mutualIds = followingIds.length > 0
    ? await getMutualFollowIds(userId, followingIds)
    : new Set<string>()

  return follows.map((f) => ({
    userId: f.following.id,
    username: f.following.username,
    displayName: f.following.displayName,
    avatarUrl: f.following.avatarUrl,
    tier: f.following.tier,
    totalCheckIns: f.following.totalCheckIns,
    isMutual: mutualIds.has(f.following.id),
  }))
}

export async function getFollowersList(userId: string) {
  const followers = await prisma.userFollow.findMany({
    where: { followingId: userId },
    include: {
      follower: {
        select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true, totalCheckIns: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const followerIds = followers.map((f) => f.followerId)
  const followingBack = followerIds.length > 0
    ? await getMutualFollowIds(userId, followerIds)
    : new Set<string>()

  return followers.map((f) => ({
    userId: f.follower.id,
    username: f.follower.username,
    displayName: f.follower.displayName,
    avatarUrl: f.follower.avatarUrl,
    tier: f.follower.tier,
    totalCheckIns: f.follower.totalCheckIns,
    isFollowingBack: followingBack.has(f.follower.id),
  }))
}

export async function searchUsers(query: string, viewerId: string) {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ],
      id: { not: viewerId },
    },
    select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true },
    take: 20,
  })

  const userIds = users.map((u) => u.id)
  const followingIds = userIds.length > 0
    ? new Set((await prisma.userFollow.findMany({
        where: { followerId: viewerId, followingId: { in: userIds } },
        select: { followingId: true },
      })).map((f) => f.followingId))
    : new Set<string>()

  const mutualIds = userIds.length > 0
    ? await getMutualFollowIds(viewerId, userIds)
    : new Set<string>()

  return users.map((u) => ({
    userId: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    tier: u.tier,
    isFollowing: followingIds.has(u.id),
    isMutual: mutualIds.has(u.id),
  }))
}
