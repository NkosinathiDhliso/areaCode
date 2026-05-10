// Prisma-backed social repository.
// Leaderboards remain in Redis (see leaderboard-redis.ts) — Postgres is the
// fallback when Redis is unavailable.

import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma.js'
import { findNearbyNodes } from '../nodes/dynamodb-repository.js'
import * as lb from './leaderboard-redis.js'
import { haversineMetres } from '../../shared/db/geohash.js'

// ─── Follows ────────────────────────────────────────────────────────────────

export async function followUser(followerId: string, followingId: string) {
  // Idempotent: ignore conflicts on (followerId, followingId) unique.
  const row = await prisma.userFollow.upsert({
    where: { followerId_followingId: { followerId, followingId } },
    create: { followerId, followingId },
    update: {},
  })
  return { followerId, followingId, createdAt: row.createdAt.toISOString() }
}

export async function unfollowUser(followerId: string, followingId: string) {
  const result = await prisma.userFollow.deleteMany({
    where: { followerId, followingId },
  })
  return { count: result.count }
}

export async function isFollowing(followerId: string, followingId: string) {
  const row = await prisma.userFollow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
    select: { id: true },
  })
  return !!row
}

export async function getMutualFollowIds(viewerId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set()

  // One round-trip: select candidates the viewer follows AND who follow the viewer back.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT a.following_id AS id
    FROM user_follows a
    JOIN user_follows b
      ON b.follower_id = a.following_id
     AND b.following_id = a.follower_id
    WHERE a.follower_id = ${viewerId}::uuid
      AND a.following_id = ANY(${candidateIds}::uuid[])
  `)

  return new Set(rows.map((r) => r.id))
}

export async function getFollowingIds(userId: string): Promise<string[]> {
  const rows = await prisma.userFollow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  })
  return rows.map((r) => r.followingId)
}

export async function getFollowerIds(userId: string): Promise<string[]> {
  const rows = await prisma.userFollow.findMany({
    where: { followingId: userId },
    select: { followerId: true },
  })
  return rows.map((r) => r.followerId)
}

// ─── Activity Feed ──────────────────────────────────────────────────────────

export async function getActivityFeed(userId: string, cursor: string | undefined, limit: number) {
  const followingIds = await getFollowingIds(userId)
  const mutualIds = Array.from(await getMutualFollowIds(userId, followingIds))
  if (mutualIds.length === 0) return { items: [], nextCursor: null, hasMore: false }

  const cursorDate = cursor ? new Date(cursor) : null

  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId: { in: mutualIds },
      ...(cursorDate ? { checkedInAt: { lt: cursorDate } } : {}),
    },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true } },
      node: { select: { id: true, name: true, slug: true, category: true } },
    },
    orderBy: { checkedInAt: 'desc' },
    take: limit + 1,
  })

  const hasMore = checkIns.length > limit
  const sliced = hasMore ? checkIns.slice(0, limit) : checkIns

  const items = sliced.map((c) => ({
    id: c.id,
    userId: c.userId,
    nodeId: c.nodeId,
    type: c.type,
    checkedInAt: c.checkedInAt.toISOString(),
    user: c.user
      ? {
          id: c.user.id,
          username: c.user.username,
          displayName: c.user.displayName,
          avatarUrl: c.user.avatarUrl,
          tier: c.user.tier,
        }
      : null,
    node: c.node ? { id: c.node.id, name: c.node.name, slug: c.node.slug, category: c.node.category } : null,
  }))

  const nextCursor =
    hasMore && sliced.length > 0 ? sliced[sliced.length - 1]!.checkedInAt.toISOString() : null

  return { items, nextCursor, hasMore }
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(
  lat: number,
  lng: number,
  radiusMetres: number,
  withinMinutes: number,
) {
  const nodes = await findNearbyNodes(lat, lng, radiusMetres / 1000, { limit: 25 })
  if (nodes.length === 0) return null

  const since = new Date(Date.now() - withinMinutes * 60 * 1000)
  const nodeIds = nodes.map((n) => n.nodeId)

  // One query: per-node most-recent check-in within the time window.
  const recents = await prisma.$queryRaw<Array<{ node_id: string; checked_in_at: Date }>>(Prisma.sql`
    SELECT DISTINCT ON (node_id) node_id, checked_in_at
    FROM check_ins
    WHERE node_id = ANY(${nodeIds}::uuid[])
      AND checked_in_at >= ${since}
    ORDER BY node_id, checked_in_at DESC
  `)

  if (recents.length === 0) return null

  let best: { nodeName: string; distanceMetres: number; minutesAgo: number } | null = null
  for (const r of recents) {
    const node = nodes.find((n) => n.nodeId === r.node_id)
    if (!node) continue
    const minutesAgo = Math.round((Date.now() - r.checked_in_at.getTime()) / 60000)
    if (minutesAgo > withinMinutes) continue
    const distance = Math.round(haversineMetres(lat, lng, node.lat, node.lng))
    if (!best || minutesAgo < best.minutesAgo) {
      best = { nodeName: node.name, distanceMetres: distance, minutesAgo }
    }
  }
  return best
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000)

  const rows = await prisma.$queryRaw<
    Array<{
      user_id: string
      checked_in_at: Date
      username: string
      display_name: string
      avatar_url: string | null
      tier: string
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (ci.user_id)
      ci.user_id,
      ci.checked_in_at,
      u.username,
      u.display_name,
      u.avatar_url,
      u.tier
    FROM check_ins ci
    JOIN users u ON u.id = ci.user_id
    WHERE ci.node_id = ${nodeId}::uuid
      AND ci.checked_in_at >= ${since}
    ORDER BY ci.user_id, ci.checked_in_at DESC
  `)

  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_url,
    tier: r.tier,
    checkedInAt: r.checked_in_at.toISOString(),
  }))
}

// ─── Leaderboard (Redis primary, Postgres fallback) ─────────────────────────

export async function getCityBySlug(slug: string) {
  const row = await prisma.city.findUnique({ where: { slug } })
  return row ? { id: row.id, slug: row.slug, name: row.name } : null
}

export async function getLeaderboardTop50(cityId: string) {
  const redis = await lb.getTopN(cityId, 50)
  if (redis) return redis

  // Postgres fallback — current week's check-ins for users in this city.
  const weekStart = new Date()
  weekStart.setUTCHours(0, 0, 0, 0)
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay())

  const rows = await prisma.$queryRaw<Array<{ user_id: string; check_in_count: bigint }>>(Prisma.sql`
    SELECT ci.user_id, COUNT(*)::bigint AS check_in_count
    FROM check_ins ci
    JOIN users u ON u.id = ci.user_id
    WHERE u.city_id = ${cityId}::uuid
      AND ci.checked_in_at >= ${weekStart}
    GROUP BY ci.user_id
    ORDER BY check_in_count DESC
    LIMIT 50
  `)

  return rows.map((r, i) => ({
    userId: r.user_id,
    checkInCount: Number(r.check_in_count),
    rank: i + 1,
  }))
}

export async function getUserLeaderboardRank(cityId: string, userId: string) {
  const redisRank = await lb.getUserRank(cityId, userId)
  if (redisRank) return redisRank

  // Postgres fallback gives true rank, not just top-50.
  const weekStart = new Date()
  weekStart.setUTCHours(0, 0, 0, 0)
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay())

  const rows = await prisma.$queryRaw<Array<{ rank: bigint; check_in_count: bigint }>>(Prisma.sql`
    WITH counts AS (
      SELECT ci.user_id, COUNT(*)::bigint AS check_in_count,
             RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
      FROM check_ins ci
      JOIN users u ON u.id = ci.user_id
      WHERE u.city_id = ${cityId}::uuid
        AND ci.checked_in_at >= ${weekStart}
      GROUP BY ci.user_id
    )
    SELECT rank, check_in_count FROM counts WHERE user_id = ${userId}::uuid
  `)

  if (rows.length === 0) return null
  return { rank: Number(rows[0]!.rank), checkInCount: Number(rows[0]!.check_in_count) }
}

export async function getUserProfiles(userIds: string[]) {
  if (userIds.length === 0) return []
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true, avatarUrl: true, tier: true },
  })
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    tier: u.tier,
  }))
}

// ─── Friends / Following / Followers ────────────────────────────────────────

export async function getMutualFriends(userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      username: string
      display_name: string
      avatar_url: string | null
      tier: string
      total_check_ins: number
    }>
  >(Prisma.sql`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.tier, u.total_check_ins
    FROM user_follows a
    JOIN user_follows b
      ON b.follower_id = a.following_id
     AND b.following_id = a.follower_id
    JOIN users u ON u.id = a.following_id
    WHERE a.follower_id = ${userId}::uuid
    ORDER BY u.display_name ASC
  `)

  return rows.map((r) => ({
    userId: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url ?? undefined,
    tier: r.tier,
    totalCheckIns: r.total_check_ins,
  }))
}

export async function getFollowingList(userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      username: string
      display_name: string
      avatar_url: string | null
      tier: string
      total_check_ins: number
      is_mutual: boolean
    }>
  >(Prisma.sql`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.tier, u.total_check_ins,
           EXISTS (
             SELECT 1 FROM user_follows m
             WHERE m.follower_id = u.id AND m.following_id = ${userId}::uuid
           ) AS is_mutual
    FROM user_follows f
    JOIN users u ON u.id = f.following_id
    WHERE f.follower_id = ${userId}::uuid
    ORDER BY u.display_name ASC
  `)

  return rows.map((r) => ({
    userId: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url ?? undefined,
    tier: r.tier,
    totalCheckIns: r.total_check_ins,
    isMutual: r.is_mutual,
  }))
}

export async function getFollowersList(userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      username: string
      display_name: string
      avatar_url: string | null
      tier: string
      total_check_ins: number
      is_following_back: boolean
    }>
  >(Prisma.sql`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.tier, u.total_check_ins,
           EXISTS (
             SELECT 1 FROM user_follows m
             WHERE m.follower_id = ${userId}::uuid AND m.following_id = u.id
           ) AS is_following_back
    FROM user_follows f
    JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = ${userId}::uuid
    ORDER BY u.display_name ASC
  `)

  return rows.map((r) => ({
    userId: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url ?? undefined,
    tier: r.tier,
    totalCheckIns: r.total_check_ins,
    isFollowingBack: r.is_following_back,
  }))
}

// ─── User Search (trigram) ──────────────────────────────────────────────────

export async function searchUsers(query: string, viewerId: string) {
  const q = query.trim()
  if (!q) return []

  // pg_trgm `%` operator + similarity for typo-tolerant fuzzy search,
  // backed by the GIN trigram indexes added in 20260331000001.
  const matches = await prisma.$queryRaw<
    Array<{
      id: string
      username: string
      display_name: string
      avatar_url: string | null
      tier: string
      similarity: number
    }>
  >(Prisma.sql`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.tier,
           GREATEST(similarity(u.username, ${q}), similarity(u.display_name, ${q})) AS similarity
    FROM users u
    WHERE u.id <> ${viewerId}::uuid
      AND (u.username % ${q} OR u.display_name % ${q})
    ORDER BY similarity DESC
    LIMIT 20
  `)

  if (matches.length === 0) return []
  const userIds = matches.map((m) => m.id)

  const [followings, mutualIds] = await Promise.all([
    prisma.userFollow.findMany({
      where: { followerId: viewerId, followingId: { in: userIds } },
      select: { followingId: true },
    }),
    getMutualFollowIds(viewerId, userIds),
  ])

  const followingSet = new Set(followings.map((f) => f.followingId))

  return matches.map((u) => ({
    userId: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    tier: u.tier,
    isFollowing: followingSet.has(u.id),
    isMutual: mutualIds.has(u.id),
  }))
}
