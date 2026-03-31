import { AppError } from '../../shared/errors/AppError.js'
import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'

const DEV_MODE = !isDbAvailable

// ─── Identity Stripper ──────────────────────────────────────────────────────

export interface IdentityFields {
  userId: string
  displayName: string | null
  username: string | null
  avatarUrl: string | null
}

/**
 * Applies friend-based visibility rules to a list of entries with identity fields.
 * - Viewer's own entries and friend entries: preserve identity, isFriend = true
 * - Non-friend entries: null out displayName, username, avatarUrl, isFriend = false
 * Idempotent: applying twice with the same params produces the same result.
 */
export function applyFriendVisibility<T extends IdentityFields>(
  entries: T[],
  friendIds: Set<string>,
  viewerId: string,
): Array<T & { isFriend: boolean }> {
  return entries.map((entry) => {
    const isFriend = entry.userId === viewerId || friendIds.has(entry.userId)

    if (isFriend) {
      return { ...entry, isFriend: true }
    }

    return {
      ...entry,
      displayName: null,
      username: null,
      avatarUrl: null,
      isFriend: false,
    }
  })
}

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
        { id: 'feed-1', checkedInAt: new Date(Date.now() - 300000).toISOString(), user: { id: 'dev-user-2', username: 'sipho_jozi', displayName: 'Sipho', avatarUrl: null, tier: 'trailblazer' }, node: { id: 'dev-3', name: "Kitchener's Bar", slug: 'kitcheners-bar', category: 'nightlife' }, isFriend: true },
        { id: 'feed-2', checkedInAt: new Date(Date.now() - 900000).toISOString(), user: { id: 'dev-user-3', username: 'thandi_sa', displayName: 'Thandi', avatarUrl: null, tier: 'explorer' }, node: { id: 'dev-6', name: 'Arts on Main', slug: 'arts-on-main', category: 'culture' }, isFriend: true },
        { id: 'feed-3', checkedInAt: new Date(Date.now() - 1800000).toISOString(), user: { id: 'dev-user-4', username: 'bongani_jhb', displayName: 'Bongani', avatarUrl: null, tier: 'explorer' }, node: { id: 'dev-1', name: 'Father Coffee', slug: 'father-coffee', category: 'coffee' }, isFriend: true },
        { id: 'feed-4', checkedInAt: new Date(Date.now() - 3600000).toISOString(), user: { id: 'dev-user-5', username: 'lerato_rosebank', displayName: 'Lerato', avatarUrl: null, tier: 'local' }, node: { id: 'dev-7', name: "Nando's Rosebank", slug: 'nandos-rosebank', category: 'food' }, isFriend: true },
        { id: 'feed-5', checkedInAt: new Date(Date.now() - 7200000).toISOString(), user: { id: 'dev-user-1', username: 'neo_sandton', displayName: 'Neo', avatarUrl: null, tier: 'local' }, node: { id: 'dev-5', name: 'Sandton City', slug: 'sandton-city', category: 'shopping' }, isFriend: true },
      ],
      nextCursor: null,
      hasMore: false,
    }
  }
  const result = await repo.getActivityFeed(userId, cursor, limit)
  // Feed only contains mutual follows — all entries are friends
  return {
    ...result,
    items: result.items.map((item: Record<string, unknown>) => ({ ...item, isFriend: true })),
  }
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

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string, viewerId?: string) {
  if (DEV_MODE) {
    return {
      totalCount: 5,
      tierDistribution: { local: 2, regular: 1, fixture: 1, institution: 1 } as Record<string, number>,
      friends: [] as Array<{ userId: string; displayName: string; username: string; avatarUrl: string | null; tier: string; checkedInAt: string }>,
    }
  }

  const entries = await repo.getWhoIsHere(nodeId)
  const totalCount = entries.length

  // Build tier distribution
  const tierDistribution: Record<string, number> = {}
  for (const e of entries) {
    tierDistribution[e.tier] = (tierDistribution[e.tier] ?? 0) + 1
  }

  // Resolve friends for authenticated viewer
  let friends: typeof entries = []
  if (viewerId) {
    const userIds = entries.map((e) => e.userId)
    const friendIds = await repo.getMutualFollowIds(viewerId, userIds)
    friends = entries.filter((e) => e.userId === viewerId || friendIds.has(e.userId))
  }

  return { totalCount, tierDistribution, friends }
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export async function getCityLeaderboard(citySlug: string, viewerId?: string) {
  if (DEV_MODE) {
    const entries = [
      { userId: 'dev-user-1', username: 'sipho_jozi', displayName: 'Sipho M.', avatarUrl: null, tier: 'trailblazer', rank: 1, checkInCount: 142, isFriend: true },
      { userId: 'dev-user-2', username: null, displayName: null, avatarUrl: null, tier: 'explorer', rank: 2, checkInCount: 98, isFriend: false },
      { userId: 'dev-user-3', username: null, displayName: null, avatarUrl: null, tier: 'explorer', rank: 3, checkInCount: 76, isFriend: false },
      { userId: 'dev-user-4', username: 'lerato_rosebank', displayName: 'Lerato D.', avatarUrl: null, tier: 'local', rank: 4, checkInCount: 54, isFriend: true },
      { userId: 'dev-user-5', username: null, displayName: null, avatarUrl: null, tier: 'local', rank: 5, checkInCount: 41, isFriend: false },
    ]
    return { entries, userRank: viewerId ? { rank: 12, checkInCount: 8 } : null }
  }

  const city = await repo.getCityBySlug(citySlug)
  if (!city) throw AppError.notFound('City not found')

  const top50 = await repo.getLeaderboardTop50(city.id)
  const userIds = top50.map((e) => e.userId)

  // Include requesting user if not in top 50
  let userRank: { rank: number; checkInCount: number } | null = null
  if (viewerId && !userIds.includes(viewerId)) {
    userRank = await repo.getUserLeaderboardRank(city.id, viewerId)
    if (userRank) userIds.push(viewerId)
  }

  const profiles = await repo.getUserProfiles(userIds)
  const profileMap = new Map(profiles.map((p) => [p.id, p]))

  const rawEntries = top50.map((e) => {
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

  // Apply friend visibility
  const friendIds = viewerId
    ? await repo.getMutualFollowIds(viewerId, rawEntries.map((e) => e.userId))
    : new Set<string>()

  const entries = applyFriendVisibility(rawEntries, friendIds, viewerId ?? '')

  return { entries, userRank }
}

// ─── Friends List ───────────────────────────────────────────────────────────

export async function getFriendsList(userId: string) {
  if (DEV_MODE) {
    return { friends: [], count: 0 }
  }
  const friends = await repo.getMutualFriends(userId)
  return { friends, count: friends.length }
}

// ─── Following List ─────────────────────────────────────────────────────────

export async function getFollowingList(userId: string) {
  if (DEV_MODE) {
    return { users: [], count: 0 }
  }
  const users = await repo.getFollowingList(userId)
  return { users, count: users.length }
}

// ─── Followers List ─────────────────────────────────────────────────────────

export async function getFollowersList(userId: string) {
  if (DEV_MODE) {
    return { users: [], count: 0 }
  }
  const users = await repo.getFollowersList(userId)
  return { users, count: users.length }
}

// ─── User Search ────────────────────────────────────────────────────────────

export async function searchUsers(viewerId: string, query: string) {
  if (DEV_MODE) {
    return { users: [] }
  }
  const users = await repo.searchUsers(query, viewerId)
  return { users }
}
