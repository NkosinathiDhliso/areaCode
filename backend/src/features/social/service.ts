import { AppError } from '../../shared/errors/AppError.js'
import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'

const DEV_MODE = !isDbAvailable

// ─── Follow / Unfollow ──────────────────────────────────────────────────────

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw AppError.badRequest('Cannot follow yourself')
  }
  if (DEV_MODE) return
  try {
    await repo.followUser(followerId, followingId)
  } catch {
    throw AppError.conflict('Already following this user')
  }
}

export async function unfollowUser(followerId: string, followingId: string) {
  if (DEV_MODE) return
  await repo.unfollowUser(followerId, followingId)
}

// ─── Activity Feed ──────────────────────────────────────────────────────────

export async function getActivityFeed(
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  if (DEV_MODE) {
    return {
      items: [
        { id: 'feed-1', type: 'checkin', userId: 'dev-user-2', username: 'sipho_jozi', displayName: 'Sipho', nodeName: "Kitchener's Bar", timestamp: new Date(Date.now() - 300000).toISOString() },
        { id: 'feed-2', type: 'checkin', userId: 'dev-user-3', username: 'thandi_sa', displayName: 'Thandi', nodeName: 'Arts on Main', timestamp: new Date(Date.now() - 900000).toISOString() },
        { id: 'feed-3', type: 'reward_claimed', userId: 'dev-user-4', username: 'bongani_jhb', displayName: 'Bongani', nodeName: 'Father Coffee', rewardTitle: 'Free Coffee', timestamp: new Date(Date.now() - 1800000).toISOString() },
      ],
      nextCursor: null,
      hasMore: false,
    }
  }
  return repo.getActivityFeed(userId, cursor, limit)
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(
  lat: number,
  lng: number,
  radiusMetres: number,
  withinMinutes: number,
) {
  if (DEV_MODE) return { event: null }
  const event = await repo.getNearbyRecentEvent(
    lat, lng, radiusMetres, withinMinutes,
  )
  return { event }
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export async function getCityLeaderboard(citySlug: string, userId?: string) {
  if (DEV_MODE) {
    const entries = [
      { userId: 'dev-user-1', username: 'sipho_jozi', displayName: 'Sipho M.', avatarUrl: null, tier: 'trailblazer', rank: 1, checkInCount: 142 },
      { userId: 'dev-user-2', username: 'thandi_sa', displayName: 'Thandi N.', avatarUrl: null, tier: 'explorer', rank: 2, checkInCount: 98 },
      { userId: 'dev-user-3', username: 'bongani_jhb', displayName: 'Bongani K.', avatarUrl: null, tier: 'explorer', rank: 3, checkInCount: 76 },
      { userId: 'dev-user-4', username: 'lerato_rosebank', displayName: 'Lerato D.', avatarUrl: null, tier: 'local', rank: 4, checkInCount: 54 },
      { userId: 'dev-user-5', username: 'neo_sandton', displayName: 'Neo P.', avatarUrl: null, tier: 'local', rank: 5, checkInCount: 41 },
    ]
    return { entries, userRank: userId ? { rank: 12, checkInCount: 8 } : null }
  }

  const city = await repo.getCityBySlug(citySlug)
  if (!city) throw AppError.notFound('City not found')

  const top50 = await repo.getLeaderboardTop50(city.id)
  const userIds = top50.map((e) => e.userId)

  // Include requesting user if not in top 50
  let userRank: { rank: number; checkInCount: number } | null = null
  if (userId && !userIds.includes(userId)) {
    userRank = await repo.getUserLeaderboardRank(city.id, userId)
    if (userRank) userIds.push(userId)
  }

  const profiles = await repo.getUserProfiles(userIds)
  const profileMap = new Map(profiles.map((p) => [p.id, p]))

  const entries = top50.map((e) => {
    const profile = profileMap.get(e.userId)
    return {
      userId: e.userId,
      username: profile?.username ?? '',
      displayName: profile?.displayName ?? '',
      avatarUrl: profile?.avatarUrl ?? null,
      tier: profile?.tier ?? 'local',
      rank: e.rank,
      checkInCount: e.checkInCount,
    }
  })

  return { entries, userRank }
}
