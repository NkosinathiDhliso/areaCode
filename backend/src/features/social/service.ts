import { AppError } from '../../shared/errors/AppError.js'
import { filterByPrivacy } from '../../shared/privacy/privacy-guard.js'
import * as repo from './repository.js'
import { deriveTopVenue } from './leaderboard-utils.js'

const DEV_MODE = process.env['AREA_CODE_ENV'] === 'dev' && !process.env['AREA_CODE_FORCE_LIVE']

/**
 * Returns the ISO string for the start of the current week (Monday 00:00 SAST).
 * Used to scope check-in queries to the current leaderboard period.
 */
function getStartOfCurrentWeek(): string {
  const now = new Date()
  // Adjust to SAST (UTC+2)
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const day = sast.getUTCDay()
  // Monday = 1, Sunday = 0 -> days since Monday
  const daysSinceMonday = day === 0 ? 6 : day - 1
  sast.setUTCDate(sast.getUTCDate() - daysSinceMonday)
  sast.setUTCHours(0, 0, 0, 0)
  // Convert back from SAST to UTC for the ISO string
  const utc = new Date(sast.getTime() - 2 * 60 * 60 * 1000)
  return utc.toISOString()
}

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

export async function getActivityFeed(userId: string, cursor: string | undefined, limit: number) {
  if (DEV_MODE) {
    const devItems = [
      {
        id: 'feed-1',
        checkedInAt: new Date(Date.now() - 300000).toISOString(),
        user: {
          id: 'dev-user-2',
          username: 'sipho_jozi',
          displayName: 'Sipho',
          avatarUrl: null,
          tier: 'trailblazer',
          archetypeId: 'archetype-nomad',
        },
        node: { id: 'dev-3', name: "Kitchener's Bar", slug: 'kitcheners-bar', category: 'nightlife' },
        isFriend: true,
      },
      {
        id: 'feed-2',
        checkedInAt: new Date(Date.now() - 900000).toISOString(),
        user: {
          id: 'dev-user-3',
          username: 'thandi_sa',
          displayName: 'Thandi',
          avatarUrl: null,
          tier: 'explorer',
          archetypeId: 'archetype-nomad',
        },
        node: { id: 'dev-6', name: 'Arts on Main', slug: 'arts-on-main', category: 'culture' },
        isFriend: true,
      },
      {
        id: 'feed-3',
        checkedInAt: new Date(Date.now() - 1800000).toISOString(),
        user: {
          id: 'dev-user-4',
          username: 'bongani_jhb',
          displayName: 'Bongani',
          avatarUrl: null,
          tier: 'explorer',
        },
        node: { id: 'dev-1', name: 'Father Coffee', slug: 'father-coffee', category: 'coffee' },
        isFriend: true,
      },
      {
        id: 'feed-4',
        checkedInAt: new Date(Date.now() - 3600000).toISOString(),
        user: {
          id: 'dev-user-5',
          username: 'lerato_rosebank',
          displayName: 'Lerato',
          avatarUrl: null,
          tier: 'local',
        },
        node: { id: 'dev-7', name: "Nando's Rosebank", slug: 'nandos-rosebank', category: 'food' },
        isFriend: true,
      },
      {
        id: 'feed-5',
        checkedInAt: new Date(Date.now() - 7200000).toISOString(),
        user: { id: 'dev-user-1', username: 'neo_sandton', displayName: 'Neo', avatarUrl: null, tier: 'local' },
        node: { id: 'dev-5', name: 'Sandton City', slug: 'sandton-city', category: 'shopping' },
        isFriend: true,
      },
    ]
    return {
      items: [
        ...devItems.map((i) => ({ ...i, feedType: 'checkin' as const })),
        {
          id: 'milestone-streak-7',
          feedType: 'milestone' as const,
          checkedInAt: new Date(Date.now() - 600000).toISOString(),
          milestoneType: 'streak' as const,
          title: '7-day streak',
          body: "You're on a 7-day check-in streak",
        },
      ],
      nextCursor: null,
      hasMore: false,
    }
  }
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
      // Discriminator so the client can render check-ins vs other feed item
      // types (live gets, archetype cluster) it composes locally (R11 / 10.1).
      feedType: 'checkin' as const,
      user: {
        ...(original.user as Record<string, unknown>),
        displayName: f.displayName,
        username: f.username,
        avatarUrl: f.avatarUrl,
      },
      isFriend: true,
    }
  })
  // Merge the viewer's own shareable milestones (R11.5). Best-effort: a read
  // failure degrades to a feed without milestone items.
  let milestones: Awaited<ReturnType<typeof import('./milestones.js').getRecentMilestones>> = []
  try {
    const { getRecentMilestones } = await import('./milestones.js')
    milestones = await getRecentMilestones(userId, 10)
  } catch {
    // non-critical
  }

  return {
    ...result,
    items: [...privacyFilteredItems, ...milestones],
  }
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(lat: number, lng: number, radiusMetres: number, withinMinutes: number) {
  if (DEV_MODE) return { event: null }
  const event = await repo.getNearbyRecentEvent(lat, lng, radiusMetres, withinMinutes)
  return { event }
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string, viewerId?: string) {
  if (DEV_MODE) {
    return {
      totalCount: 5,
      tierDistribution: { local: 2, regular: 1, fixture: 1, institution: 1 } as Record<string, number>,
      friends: [] as Array<{
        userId: string
        displayName: string
        username: string
        avatarUrl: string | null
        tier: string
        checkedInAt: string
      }>,
    }
  }

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

export async function getCityLeaderboard(citySlug: string, viewerId?: string, archetypeId?: string) {
  const segment: 'archetype' | 'city-wide' = archetypeId ? 'archetype' : 'city-wide'

  if (DEV_MODE) {
    const entries = [
      {
        userId: 'dev-user-1',
        username: 'sipho_jozi',
        displayName: 'Sipho M.',
        avatarUrl: null,
        tier: 'trailblazer',
        rank: 1,
        checkInCount: 142,
        isFriend: true,
        archetypeId: archetypeId ?? 'archetype-nomad',
        topVenueId: 'dev-3',
        topVenueName: "Kitchener's Bar",
      },
      {
        userId: 'dev-user-2',
        username: null,
        displayName: null,
        avatarUrl: null,
        tier: 'explorer',
        rank: 2,
        checkInCount: 98,
        isFriend: false,
        archetypeId: archetypeId ?? 'archetype-nomad',
        topVenueId: 'dev-6',
        topVenueName: 'Arts on Main',
      },
      {
        userId: 'dev-user-3',
        username: null,
        displayName: null,
        avatarUrl: null,
        tier: 'explorer',
        rank: 3,
        checkInCount: 76,
        isFriend: false,
        archetypeId: archetypeId ?? 'archetype-eclectic',
        topVenueId: undefined,
        topVenueName: undefined,
      },
      {
        userId: 'dev-user-4',
        username: 'lerato_rosebank',
        displayName: 'Lerato D.',
        avatarUrl: null,
        tier: 'local',
        rank: 4,
        checkInCount: 54,
        isFriend: true,
        archetypeId: archetypeId ?? 'archetype-eclectic',
        topVenueId: 'dev-1',
        topVenueName: 'Father Coffee',
      },
      {
        userId: 'dev-user-5',
        username: null,
        displayName: null,
        avatarUrl: null,
        tier: 'local',
        rank: 5,
        checkInCount: 41,
        isFriend: false,
        archetypeId: archetypeId ?? 'archetype-nomad',
        topVenueId: undefined,
        topVenueName: undefined,
      },
    ]
    return { entries, userRank: viewerId ? { rank: 12, checkInCount: 8 } : null, segment }
  }

  const city = await repo.getCityBySlug(citySlug)
  if (!city) throw AppError.notFound('City not found')

  const top50 = await repo.getLeaderboardTop50(city.id, archetypeId)
  const userIds = top50.map((e) => e.userId)

  // Include requesting user if not in top 50
  let userRank: { rank: number; checkInCount: number } | null = null
  if (viewerId && !userIds.includes(viewerId)) {
    userRank = await repo.getUserLeaderboardRank(city.id, viewerId)
    if (userRank) userIds.push(viewerId)
  }

  const profiles = await repo.getUserProfiles(userIds)
  const profileMap = new Map(profiles.map((p) => [p.id, p]))

  // For entries missing topVenueId, compute from check-in history
  const startOfWeek = getStartOfCurrentWeek()
  const now = new Date().toISOString()

  const enrichedTop50 = await Promise.all(
    top50.map(async (e) => {
      if (e.topVenueId) return e
      // Derive topVenue from user's check-in history this period
      try {
        const { getCheckInsByUser } = await import('../check-in/dynamodb-repository.js')
        const { checkIns } = await getCheckInsByUser(e.userId, {
          startTime: startOfWeek,
          endTime: now,
          limit: 200,
        })
        const result = deriveTopVenue(checkIns.map((ci) => ({ nodeId: ci.nodeId, checkedInAt: ci.checkedInAt })))
        if (result) {
          // Resolve venue name
          const { getNodeById } = await import('../nodes/dynamodb-repository.js')
          const node = await getNodeById(result.topVenueId)
          return {
            ...e,
            topVenueId: result.topVenueId,
            topVenueName: node?.name ?? undefined,
          }
        }
      } catch {
        // Non-critical: degrade gracefully without top venue
      }
      return e
    }),
  )

  const rawEntries = enrichedTop50.map((e) => {
    const profile = profileMap.get(e.userId)
    return {
      userId: e.userId,
      username: profile?.username ?? '',
      displayName: profile?.displayName ?? '',
      avatarUrl: profile?.avatarUrl ?? null,
      tier: profile?.tier ?? 'local',
      rank: e.rank,
      checkInCount: e.checkInCount,
      archetypeId: e.archetypeId,
      topVenueId: e.topVenueId,
      topVenueName: e.topVenueName,
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
    // Respect privacy: only show venue callout when user's identity is visible
    // (Privacy guard already nulls displayName for anonymous users; use that as signal)
    topVenueId: entry.displayName ? entry.topVenueId : undefined,
    topVenueName: entry.displayName ? entry.topVenueName : undefined,
  }))

  return { entries, userRank, segment }
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

// ─── Friends Presence ───────────────────────────────────────────────────────

export async function getFriendsPresence(userId: string) {
  if (DEV_MODE) {
    return {
      items: [
        {
          nodeId: 'dev-3',
          userId: 'dev-user-2',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        {
          nodeId: 'dev-1',
          userId: 'dev-user-3',
          expiresAt: new Date(Date.now() + 1800000).toISOString(),
        },
      ],
    }
  }

  // Get mutual friend IDs
  const followingIds = await repo.getFollowingIds(userId)
  const mutualIds = await repo.getMutualFollowIds(userId, followingIds)

  // Query active presence for each mutual friend
  const nowSeconds = Math.floor(Date.now() / 1000)
  const items = await repo.getFriendsPresence(Array.from(mutualIds), nowSeconds)

  return { items }
}
