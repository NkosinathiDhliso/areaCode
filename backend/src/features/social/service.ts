import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'

// ─── Follow / Unfollow ──────────────────────────────────────────────────────

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw AppError.badRequest('Cannot follow yourself')
  }
  try {
    await repo.followUser(followerId, followingId)
  } catch {
    throw AppError.conflict('Already following this user')
  }
}

export async function unfollowUser(followerId: string, followingId: string) {
  await repo.unfollowUser(followerId, followingId)
}

// ─── Activity Feed ──────────────────────────────────────────────────────────

export async function getActivityFeed(
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  return repo.getActivityFeed(userId, cursor, limit)
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(
  lat: number,
  lng: number,
  radiusMetres: number,
  withinMinutes: number,
) {
  const event = await repo.getNearbyRecentEvent(
    lat, lng, radiusMetres, withinMinutes,
  )
  return { event }
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export async function getCityLeaderboard(citySlug: string, userId?: string) {
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
