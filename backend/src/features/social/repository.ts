// DynamoDB-backed Social Repository (replaces Prisma + Redis)
import { GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { getUserById } from '../auth/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'
import { getNodeById } from '../nodes/dynamodb-repository.js'

// ─── Follows ────────────────────────────────────────────────────────────────

export async function followUser(followerId: string, followingId: string) {
  const now = new Date().toISOString()
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `FOLLOW#${followerId}`,
        sk: `FOLLOWING#${followingId}`,
        gsi1pk: `FOLLOWERS#${followingId}`,
        gsi1sk: `FOLLOWER#${followerId}`,
        followerId,
        followingId,
        createdAt: now,
      },
    }),
  )
  return { followerId, followingId, createdAt: now }
}

export async function unfollowUser(followerId: string, followingId: string) {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `FOLLOW#${followerId}`, sk: `FOLLOWING#${followingId}` },
    }),
  )
  return { count: 1 }
}

export async function isFollowing(followerId: string, followingId: string) {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `FOLLOW#${followerId}`, sk: `FOLLOWING#${followingId}` },
    }),
  )
  return !!result.Item
}

export async function getMutualFollowIds(viewerId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set()
  // Resolve every candidate concurrently: this runs on the check-in and
  // check-out hot paths, so a sequential loop would add one round-trip per
  // candidate to the request latency.
  const checked = await Promise.all(
    candidateIds.map(async (cid) => {
      const [forward, reverse] = await Promise.all([isFollowing(viewerId, cid), isFollowing(cid, viewerId)])
      return forward && reverse ? cid : null
    }),
  )
  return new Set(checked.filter((cid): cid is string => cid !== null))
}

export async function getFollowingIds(userId: string): Promise<string[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`,
        ':prefix': 'FOLLOWING#',
      },
    }),
  )
  return (result.Items || []).map((i) => i['followingId'] as string)
}

// ─── Activity Feed ──────────────────────────────────────────────────────────

export async function getActivityFeed(userId: string, cursor: string | undefined, limit: number) {
  // Get mutual friends
  const followingIds = await getFollowingIds(userId)
  const mutualIds = await getMutualFollowIds(userId, followingIds)

  // Get recent check-ins from mutual friends via UserIndex. Fan out per friend
  // concurrently, fetch each friend's profile ONCE (not once per check-in as
  // before), and resolve the check-in venues in parallel. This turns a
  // sequential N+M+K round-trip chain into a bounded set of parallel batches.
  const perFriend = await Promise.all(
    [...mutualIds].map(async (fid) => {
      const [user, result] = await Promise.all([
        getUserById(fid),
        documentClient.send(
          new QueryCommand({
            TableName: TableNames.checkins,
            IndexName: 'UserIndex',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': fid },
            ScanIndexForward: false,
            Limit: limit,
          }),
        ),
      ])
      const checkIns = result.Items || []
      const nodes = await Promise.all(checkIns.map((ci) => getNodeById(ci['nodeId'] as string)))
      return checkIns.map((ci, i) => {
        const node = nodes[i]
        return {
          ...ci,
          checkedInAt: ci['checkedInAt'] as string,
          user: user
            ? {
                id: user.userId,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                tier: user.tier,
                // Carried so the client archetype cluster (R11.3) can match the
                // checking-in user's archetype against the consumer's.
                archetypeId: user.archetypeId ?? null,
              }
            : null,
          node: node ? { id: node.nodeId, name: node.name, slug: node.slug, category: node.category } : null,
        }
      })
    }),
  )
  const allItems: any[] = perFriend.flat()

  // Sort by checkedInAt descending, apply cursor
  allItems.sort((a, b) => (b.checkedInAt || '').localeCompare(a.checkedInAt || ''))
  const filtered = cursor ? allItems.filter((i) => i.checkedInAt < cursor) : allItems
  const sliced = filtered.slice(0, limit)
  const hasMore = filtered.length > limit
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.checkedInAt : null

  return { items: sliced, nextCursor, hasMore }
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(lat: number, lng: number, radiusMetres: number, withinMinutes: number) {
  // Scan all nodes and check distance, then find recent check-ins
  const nodesResult = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':active': true },
    }),
  )

  const nearbyNodes: Array<{ nodeId: string; name: string; distance: number }> = []
  for (const n of nodesResult.Items || []) {
    const nLat = n['lat'] as number
    const nLng = n['lng'] as number
    const R = 6371000
    const dLat = ((nLat - lat) * Math.PI) / 180
    const dLng = ((nLng - lng) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) * Math.cos((nLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
    const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (distance <= radiusMetres) {
      nearbyNodes.push({ nodeId: n['nodeId'] as string, name: n['name'] as string, distance })
    }
  }

  // Find most recent check-in at any nearby node
  let best: { nodeName: string; distanceMetres: number; minutesAgo: number } | null = null
  for (const nn of nearbyNodes) {
    const { checkIns } = await getCheckInsByNode(nn.nodeId, { limit: 1 })
    if (checkIns.length > 0) {
      const ci = checkIns[0]!
      const minutesAgo = Math.round((Date.now() - new Date(ci.checkedInAt).getTime()) / 60000)
      if (minutesAgo <= withinMinutes) {
        if (!best || minutesAgo < best.minutesAgo) {
          best = { nodeName: nn.name, distanceMetres: Math.round(nn.distance), minutesAgo }
        }
      }
    }
  }
  return best
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string) {
  const { checkIns } = await getCheckInsByNode(nodeId, { hours: 1 })
  const seen = new Set<string>()
  const results = []
  for (const ci of checkIns) {
    if (seen.has(ci.userId)) continue
    seen.add(ci.userId)
    const user = await getUserById(ci.userId)
    if (user) {
      results.push({
        userId: user.userId,
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        tier: user.tier,
        checkedInAt: ci.checkedInAt,
      })
    }
  }
  return results
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export async function getCityBySlug(slug: string) {
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${slug}`, sk: `CITY#${slug}` } }),
  )
  return result.Item ? { id: result.Item['cityId'] ?? slug, slug, name: result.Item['name'] } : null
}

// Shared full-partition read + sort + rank for the canonical leaderboard key.
// Both getLeaderboardTop50 and getUserLeaderboardRank read through this single helper so
// their query, sort, and tiebreak can never drift (dry-reuse-no-duplication.md). Ranks are
// assigned across the FULL sorted set, so callers get exact ranks even outside the top 50.
async function readRankedLeaderboard(cityId: string, archetypeId?: string) {
  // Canonical leaderboard key (must match the incrementer exactly):
  //   pk = LEADERBOARD#{cityId}, sk = USER#{userId}, attribute checkInCount.
  // The sort key is USER#{userId}, so DynamoDB cannot order by checkInCount. Read the
  // full partition (paginated) and sort by checkInCount desc in memory.
  const items: Record<string, unknown>[] = []
  let lastEvaluatedKey: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `LEADERBOARD#${cityId}` },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    )
    for (const item of result.Items || []) items.push(item)
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastEvaluatedKey)

  // Archetype segment filter: applied after read, only when an archetypeId is supplied and
  // stored on entries; otherwise the board is city-wide (behavior consistent with before).
  const scoped = archetypeId ? items.filter((item) => item['archetypeId'] === archetypeId) : items

  return (
    scoped
      .map((item) => ({
        userId: item['userId'] as string,
        checkInCount: (item['checkInCount'] as number) ?? 0,
        archetypeId: (item['archetypeId'] as string) ?? undefined,
        topVenueId: (item['topVenueId'] as string) ?? undefined,
        topVenueName: (item['topVenueName'] as string) ?? undefined,
      }))
      // Sort desc by checkInCount; deterministic tiebreak by userId (ascending).
      .sort((a, b) => b.checkInCount - a.checkInCount || a.userId.localeCompare(b.userId))
      .map((entry, i) => ({ ...entry, rank: i + 1 }))
  )
}

export async function getLeaderboardTop50(cityId: string, archetypeId?: string) {
  // Ranks are assigned across the full sorted set, so the first 50 keep ranks 1..50.
  return (await readRankedLeaderboard(cityId, archetypeId)).slice(0, 50)
}

export async function getUserLeaderboardRank(cityId: string, userId: string) {
  // Reuse the same full-partition read/sort/rank so the viewer's exact rank is resolved
  // even when they sit outside the top 50. Return null only when they have no entry.
  const ranked = await readRankedLeaderboard(cityId)
  const entry = ranked.find((e) => e.userId === userId)
  if (!entry) return null
  return { rank: entry.rank, checkInCount: entry.checkInCount }
}

export async function getUserProfiles(userIds: string[]) {
  if (userIds.length === 0) return []
  const users = await Promise.all(userIds.map((uid) => getUserById(uid)))
  return users
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((user) => ({
      id: user.userId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      tier: user.tier,
    }))
}

// ─── Friends / Following / Followers ────────────────────────────────────────

export async function getMutualFriends(userId: string) {
  const followingIds = await getFollowingIds(userId)
  const mutualIds = await getMutualFollowIds(userId, followingIds)

  const users = await Promise.all([...mutualIds].map((fid) => getUserById(fid)))
  const friends = users
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((user) => ({
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      tier: user.tier,
      totalCheckIns: (user as any).totalCheckIns ?? 0,
    }))
  return friends.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
}

export async function getFollowingList(userId: string) {
  const followingIds = await getFollowingIds(userId)
  const mutualIds = await getMutualFollowIds(userId, followingIds)

  const users = await Promise.all(followingIds.map((fid) => getUserById(fid)))
  return users
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((user) => ({
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      tier: user.tier,
      totalCheckIns: (user as any).totalCheckIns ?? 0,
      isMutual: mutualIds.has(user.userId),
    }))
}

export async function getFollowersList(userId: string) {
  // Query GSI1 for followers of this user
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `FOLLOWERS#${userId}` },
    }),
  )
  const followerIds = (result.Items || []).map((i) => i['followerId'] as string)
  const followingBack = followerIds.length > 0 ? await getMutualFollowIds(userId, followerIds) : new Set<string>()

  const users = await Promise.all(followerIds.map((fid) => getUserById(fid)))
  return users
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((user) => ({
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      tier: user.tier,
      totalCheckIns: (user as any).totalCheckIns ?? 0,
      isFollowingBack: followingBack.has(user.userId),
    }))
}

export async function searchUsers(query: string, viewerId: string) {
  // Prefix search via the sparse, char-bucketed GSIs (UsernameSearchIndex /
  // DisplayNameSearchIndex). The first character is the partition, the
  // lowercased value the range key queried with begins_with. This replaces the
  // former full-table Scan, which only ever read the first 1MB page and did not
  // scale. Both indexes are queried in parallel and merged.
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const bucket = q[0]

  const [byUsername, byDisplayName] = await Promise.all([
    documentClient.send(
      new QueryCommand({
        TableName: TableNames.users,
        IndexName: 'UsernameSearchIndex',
        KeyConditionExpression: 'usernameChar = :c AND begins_with(usernameLower, :q)',
        ExpressionAttributeValues: { ':c': bucket, ':q': q },
        Limit: 25,
      }),
    ),
    documentClient.send(
      new QueryCommand({
        TableName: TableNames.users,
        IndexName: 'DisplayNameSearchIndex',
        KeyConditionExpression: 'displayNameChar = :c AND begins_with(displayNameLower, :q)',
        ExpressionAttributeValues: { ':c': bucket, ':q': q },
        Limit: 25,
      }),
    ),
  ])

  // Merge both indexes, dedup by userId, drop the viewer, cap at 20.
  const byId = new Map<string, Record<string, unknown>>()
  for (const item of [...(byUsername.Items || []), ...(byDisplayName.Items || [])]) {
    const uid = item['userId'] as string
    if (uid === viewerId) continue
    if (!byId.has(uid)) byId.set(uid, item)
  }
  const users = Array.from(byId.values()).slice(0, 20)

  const userIds = users.map((u) => u['userId'] as string)
  const followingFlags = await Promise.all(userIds.map((uid) => isFollowing(viewerId, uid)))
  const followingSet = new Set<string>(userIds.filter((_, i) => followingFlags[i]))
  const mutualIds = userIds.length > 0 ? await getMutualFollowIds(viewerId, userIds) : new Set<string>()

  return users.map((u) => {
    const uid = u['userId'] as string
    return {
      userId: uid,
      username: u['username'],
      displayName: u['displayName'],
      avatarUrl: u['avatarUrl'],
      tier: u['tier'],
      isFollowing: followingSet.has(uid),
      isMutual: mutualIds.has(uid),
    }
  })
}

// ─── Friends Presence ───────────────────────────────────────────────────────

/**
 * Get active (non-expired) presence records for a set of mutual friends.
 * Queries the `presence` table by userId (PK) for each friend, filtering for
 * `presenceState = 'present' AND expiresAt > nowSeconds`.
 *
 * Returns flat list: { nodeId, userId, expiresAt (ISO string) }
 */
export async function getFriendsPresence(
  friendIds: string[],
  nowSeconds: number,
): Promise<Array<{ nodeId: string; userId: string; expiresAt: string }>> {
  if (friendIds.length === 0) return []

  // Query the presence table for each friend concurrently (PK userId, SK
  // nodeId), filtering to live records. Fanned out in parallel so seeding a
  // session with many friends is one round-trip, not one per friend.
  const perFriend = await Promise.all(
    friendIds.map(async (friendId) => {
      const queryResult = await documentClient.send(
        new QueryCommand({
          TableName: TableNames.presence,
          KeyConditionExpression: 'userId = :uid',
          FilterExpression: 'presenceState = :present AND expiresAt > :now',
          ExpressionAttributeValues: {
            ':uid': friendId,
            ':present': 'present',
            ':now': nowSeconds,
          },
        }),
      )
      return (queryResult.Items || []).map((item) => ({
        nodeId: item['nodeId'] as string,
        userId: friendId,
        expiresAt: new Date((item['expiresAt'] as number) * 1000).toISOString(),
      }))
    }),
  )

  return perFriend.flat()
}
