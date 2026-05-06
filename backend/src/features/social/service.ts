import { AppError } from '../../shared/errors/AppError.js'
import { filterByPrivacy } from '../../shared/privacy/privacy-guard.js'
import * as repo from './repository.js'

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

export async function getActivityFeed(userId: string, cursor: string | undefined, limit: number) {
  const result = await repo.getActivityFeed(userId, cursor, limit)
  // Apply privacy filtering — excluded users are removed, anonymous users have identity nulled
  const filteredItems = await filterByPrivacy(
    result.items.map((item: Record<string, unknown>) => ({
      userId: ((item.user as Record<string, unknown>)?.id as string) ?? '',
      displayName: ((item.user as Record<string, unknown>)?.displayName as string | null) ?? null,
      username: ((item.user as Record<string, unknown>)?.username as string | null) ?? null,
      avatarUrl: ((item.user as Record<string, unknown>)?.avatarUrl as string | null) ?? null,
      _original: item,
    })),
    userId,
  )
  // Reconstruct feed items with privacy applied
  const privacyFilteredItems = filteredItems.map((f) => {
    const original = f._original as Record<string, unknown>
    return {
      ...original,
      user: {
        ...(original.user as Record<string, unknown>),
        displayName: f.displayName,
        username: f.username,
        avatarUrl: f.avatarUrl,
      },
      isFriend: true,
    }
  })
  return {
    ...result,
    items: privacyFilteredItems,
  }
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(lat: number, lng: number, radiusMetres: number, withinMinutes: number) {
  const event = await repo.getNearbyRecentEvent(lat, lng, radiusMetres, withinMinutes)
  return { event }
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string, viewerId?: string) {
  const entries = await repo.getWhoIsHere(nodeId)

  // Apply privacy filtering — excluded users are removed entirely,
  // anonymous users contribute to counts but not the friends list
  const privacyFiltered = await filterByPrivacy(entries, viewerId ?? null)

  const totalCount = privacyFiltered.length
  // Build tier distribution from all non-excluded entries (including anonymous)
  const tierDistribution: Record<string, number> = {}
  for (const e of privacyFiltered) {
    const t = e.tier ?? 'unknown'
    tierDistribution[t] = (tierDistribution[t] ?? 0) + 1
  }

  // Resolve friends for authenticated viewer — only fully visible entries
  let friends: typeof entries = []
  if (viewerId) {
    const visibleEntries = privacyFiltered.filter((e) => e.privacyVisibility === 'full')
    const userIds = visibleEntries.map((e) => e.userId)
    const friendIds = await repo.getMutualFollowIds(viewerId, userIds)
    friends = visibleEntries
      .filter((e) => e.userId === viewerId || friendIds.has(e.userId))
      .map(({ privacyVisibility, ...rest }) => rest)
  }

  return { totalCount, tierDistribution, friends }
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export async function getCityLeaderboard(citySlug: string, viewerId?: string) {
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

  // Apply privacy filtering via PrivacyGuard — replaces applyFriendVisibility
  // Excluded users are removed, anonymous users have identity nulled
  const privacyFiltered = await filterByPrivacy(rawEntries, viewerId ?? null)

  // Also apply friend visibility for the isFriend flag (backward compat)
  const friendIds = viewerId
    ? await repo.getMutualFollowIds(
        viewerId,
        privacyFiltered.map((e) => e.userId),
      )
    : new Set<string>()

  const entries = privacyFiltered.map((entry) => ({
    ...entry,
    isFriend: entry.userId === (viewerId ?? '') || friendIds.has(entry.userId),
  }))

  return { entries, userRank }
}

// ─── Friends List ───────────────────────────────────────────────────────────

export async function getFriendsList(userId: string) {
  const friends = await repo.getMutualFriends(userId)
  return { friends, count: friends.length }
}

// ─── Following List ─────────────────────────────────────────────────────────

export async function getFollowingList(userId: string) {
  const users = await repo.getFollowingList(userId)
  return { users, count: users.length }
}

// ─── Followers List ─────────────────────────────────────────────────────────

export async function getFollowersList(userId: string) {
  const users = await repo.getFollowersList(userId)
  return { users, count: users.length }
}

// ─── User Search ────────────────────────────────────────────────────────────

export async function searchUsers(viewerId: string, query: string) {
  const users = await repo.searchUsers(query, viewerId)
  return { users }
}
