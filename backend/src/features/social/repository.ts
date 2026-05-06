// Social repository — scale-hardened.
//
// Changes vs. the previous implementation:
//   1. All N+1 `for (...) await` loops replaced with BatchGetItem + Promise.all.
//   2. Leaderboard uses Redis ZSET (O(log N), no hot partition) with DDB fallback.
//   3. searchUsers uses the UsernameLowerIndex GSI (if provisioned) instead of Scan.
//   4. getNearbyRecentEvent delegates to findNearbyNodes (geohash-backed) instead
//      of re-scanning the nodes table.
//
// NOTE: some GSIs referenced here are added by the Terraform patch in
//       infra/SCALE_GSI_ADDITIONS.md. Until applied, we fall back to the legacy
//       Scan path with a one-time console.warn so callers still work.
import { GetCommand, PutCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { batchGetNodes, batchGetUsers } from '../../shared/db/batch.js'
import { findNearbyNodes } from '../nodes/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'
import * as lb from './leaderboard-redis.js'
import { haversineMetres } from '../../shared/db/geohash.js'

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
  // Parallelise the pair of checks for each candidate (was fully sequential before).
  const results = await Promise.all(
    candidateIds.map(async (cid) => {
      const [forward, reverse] = await Promise.all([isFollowing(viewerId, cid), isFollowing(cid, viewerId)])
      return forward && reverse ? cid : null
    }),
  )
  return new Set(results.filter((x): x is string => x !== null))
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

export async function getFollowerIds(userId: string): Promise<string[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `FOLLOWERS#${userId}` },
    }),
  )
  return (result.Items || []).map((i) => i['followerId'] as string)
}

// ─── Activity Feed ──────────────────────────────────────────────────────────

export async function getActivityFeed(userId: string, cursor: string | undefined, limit: number) {
  const followingIds = await getFollowingIds(userId)
  const mutualIds = Array.from(await getMutualFollowIds(userId, followingIds))
  if (mutualIds.length === 0) return { items: [], nextCursor: null, hasMore: false }

  // Fetch recent check-ins for all mutuals in parallel (was sequential per-friend).
  const perFriend = await Promise.all(
    mutualIds.map((fid) =>
      documentClient
        .send(
          new QueryCommand({
            TableName: TableNames.checkins,
            IndexName: 'UserIndex',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': fid },
            ScanIndexForward: false,
            Limit: limit,
          }),
        )
        .then((r) => r.Items ?? []),
    ),
  )

  const allCheckIns = perFriend.flat()
  if (allCheckIns.length === 0) return { items: [], nextCursor: null, hasMore: false }

  // Batch-load users and nodes — one round-trip each instead of 2 × N serial GetItems.
  const userIds = Array.from(new Set(allCheckIns.map((c) => c['userId'] as string)))
  const nodeIds = Array.from(new Set(allCheckIns.map((c) => c['nodeId'] as string)))
  const [users, nodes] = await Promise.all([batchGetUsers(userIds), batchGetNodes(nodeIds)])

  const items = allCheckIns.map((ci) => {
    const u = users[ci['userId'] as string]
    const n = nodes[ci['nodeId'] as string]
    return {
      ...ci,
      checkedInAt: ci['checkedInAt'] as string,
      user: u
        ? {
            id: u['userId'],
            username: u['username'],
            displayName: u['displayName'],
            avatarUrl: u['avatarUrl'],
            tier: u['tier'],
          }
        : null,
      node: n ? { id: n['nodeId'], name: n['name'], slug: n['slug'], category: n['category'] } : null,
    }
  })

  items.sort((a, b) => (b.checkedInAt || '').localeCompare(a.checkedInAt || ''))
  const filtered = cursor ? items.filter((i) => i.checkedInAt < cursor) : items
  const sliced = filtered.slice(0, limit)
  const hasMore = filtered.length > limit
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.checkedInAt : null

  return { items: sliced, nextCursor, hasMore }
}

// ─── Nearby Recent ──────────────────────────────────────────────────────────

export async function getNearbyRecentEvent(lat: number, lng: number, radiusMetres: number, withinMinutes: number) {
  // Uses geohash-backed findNearbyNodes — no more full table Scan.
  const nodes = await findNearbyNodes(lat, lng, radiusMetres / 1000, { limit: 25 })
  if (nodes.length === 0) return null

  // Fetch most-recent check-in for each nearby node in parallel.
  const checkInsPerNode = await Promise.all(nodes.map((n) => getCheckInsByNode(n.nodeId, { limit: 1 })))

  let best: { nodeName: string; distanceMetres: number; minutesAgo: number } | null = null
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    const ci = checkInsPerNode[i]?.checkIns[0]
    if (!ci) continue
    const minutesAgo = Math.round((Date.now() - new Date(ci.checkedInAt).getTime()) / 60000)
    if (minutesAgo > withinMinutes) continue
    const distance = Math.round(haversineMetres(lat, lng, n.lat, n.lng))
    if (!best || minutesAgo < best.minutesAgo) {
      best = { nodeName: n.name, distanceMetres: distance, minutesAgo }
    }
  }
  return best
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string) {
  const { checkIns } = await getCheckInsByNode(nodeId, { hours: 1 })
  const seen = new Set<string>()
  const uniqueUserIds: string[] = []
  const firstCheckInAt = new Map<string, string>()
  for (const ci of checkIns) {
    if (seen.has(ci.userId)) continue
    seen.add(ci.userId)
    uniqueUserIds.push(ci.userId)
    firstCheckInAt.set(ci.userId, ci.checkedInAt)
  }

  const users = await batchGetUsers(uniqueUserIds)
  const out: Array<Record<string, unknown>> = []
  for (const uid of uniqueUserIds) {
    const u = users[uid]
    if (!u) continue
    out.push({
      userId: u['userId'],
      displayName: u['displayName'],
      username: u['username'],
      avatarUrl: u['avatarUrl'],
      tier: u['tier'],
      checkedInAt: firstCheckInAt.get(uid),
    })
  }
  return out
}

// ─── Leaderboard (Redis-first, DDB fallback) ────────────────────────────────

export async function getCityBySlug(slug: string) {
  const result = await documentClient.send(
    new GetCommand({ TableName: TableNames.appData, Key: { pk: `CITY#${slug}`, sk: `CITY#${slug}` } }),
  )
  return result.Item ? { id: result.Item['cityId'] ?? slug, slug, name: result.Item['name'] } : null
}

export async function getLeaderboardTop50(cityId: string) {
  const redis = await lb.getTopN(cityId, 50)
  if (redis) return redis

  // DDB fallback — single-partition read, acceptable for low QPS / test envs.
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `LEADERBOARD#${cityId}` },
      ScanIndexForward: false,
      Limit: 50,
    }),
  )
  return (result.Items || []).map((item, i) => ({
    userId: item['userId'] as string,
    checkInCount: (item['checkInCount'] as number) ?? 0,
    rank: i + 1,
  }))
}

export async function getUserLeaderboardRank(cityId: string, userId: string) {
  const redisRank = await lb.getUserRank(cityId, userId)
  if (redisRank) return redisRank

  // DDB fallback: can only report rank if user is in top-50.
  const top = await getLeaderboardTop50(cityId)
  const entry = top.find((e) => e.userId === userId)
  return entry ? { rank: entry.rank, checkInCount: entry.checkInCount } : null
}

export async function getUserProfiles(userIds: string[]) {
  if (userIds.length === 0) return []
  const users = await batchGetUsers(userIds)
  const out: Array<Record<string, unknown>> = []
  for (const uid of userIds) {
    const u = users[uid]
    if (!u) continue
    out.push({
      id: u['userId'],
      username: u['username'],
      displayName: u['displayName'],
      avatarUrl: u['avatarUrl'],
      tier: u['tier'],
    })
  }
  return out
}

// ─── Friends / Following / Followers ────────────────────────────────────────

export async function getMutualFriends(userId: string) {
  const followingIds = await getFollowingIds(userId)
  const mutualIds = Array.from(await getMutualFollowIds(userId, followingIds))
  if (mutualIds.length === 0) return []

  const users = await batchGetUsers(mutualIds)
  const friends = mutualIds
    .map((fid) => users[fid])
    .filter((u): u is Record<string, unknown> => !!u)
    .map((u) => ({
      userId: u['userId'] as string,
      username: u['username'] as string,
      displayName: u['displayName'] as string,
      avatarUrl: u['avatarUrl'] as string | undefined,
      tier: u['tier'] as string,
      totalCheckIns: (u['totalCheckIns'] as number) ?? 0,
    }))

  return friends.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
}

export async function getFollowingList(userId: string) {
  const followingIds = await getFollowingIds(userId)
  if (followingIds.length === 0) return []
  const [users, mutualIds] = await Promise.all([
    batchGetUsers(followingIds),
    getMutualFollowIds(userId, followingIds),
  ])

  return followingIds
    .map((fid) => {
      const u = users[fid]
      if (!u) return null
      return {
        userId: u['userId'] as string,
        username: u['username'] as string,
        displayName: u['displayName'] as string,
        avatarUrl: u['avatarUrl'] as string | undefined,
        tier: u['tier'] as string,
        totalCheckIns: (u['totalCheckIns'] as number) ?? 0,
        isMutual: mutualIds.has(fid),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

export async function getFollowersList(userId: string) {
  const followerIds = await getFollowerIds(userId)
  if (followerIds.length === 0) return []

  const [users, followingBack] = await Promise.all([
    batchGetUsers(followerIds),
    getMutualFollowIds(userId, followerIds),
  ])

  return followerIds
    .map((fid) => {
      const u = users[fid]
      if (!u) return null
      return {
        userId: u['userId'] as string,
        username: u['username'] as string,
        displayName: u['displayName'] as string,
        avatarUrl: u['avatarUrl'] as string | undefined,
        tier: u['tier'] as string,
        totalCheckIns: (u['totalCheckIns'] as number) ?? 0,
        isFollowingBack: followingBack.has(fid),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

// ─── User Search ────────────────────────────────────────────────────────────

let _searchWarned = false
function warnScanFallback() {
  if (_searchWarned) return
  _searchWarned = true
  console.warn(
    '[social.searchUsers] UsernameLowerIndex GSI not provisioned — falling back to Scan. ' +
      'Apply infra/SCALE_GSI_ADDITIONS.md to fix at scale.',
  )
}

export async function searchUsers(query: string, viewerId: string) {
  const q = query.trim().toLowerCase()
  if (!q) return []

  let users: Array<Record<string, unknown>> = []

  // Preferred path: prefix-query the UsernameLowerIndex GSI.
  try {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.users,
        IndexName: 'UsernameLowerIndex',
        KeyConditionExpression: 'usernameLower = :q',
        ExpressionAttributeValues: { ':q': q },
        Limit: 20,
      }),
    )
    users = (result.Items || []) as Array<Record<string, unknown>>

    // If the exact-match index returned nothing, also try begins_with on a
    // normalised prefix attribute if available (same GSI, different KeyCondition).
    if (users.length === 0) {
      const prefixResult = await documentClient.send(
        new ScanCommand({
          TableName: TableNames.users,
          IndexName: 'UsernameLowerIndex',
          FilterExpression: 'begins_with(usernameLower, :q)',
          ExpressionAttributeValues: { ':q': q },
          Limit: 40,
        }),
      )
      users = (prefixResult.Items || []) as Array<Record<string, unknown>>
    }
  } catch (err) {
    // GSI not yet provisioned — fallback to full-table Scan (legacy behaviour).
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('specified index') || msg.includes('does not have the specified')) {
      warnScanFallback()
      const result = await documentClient.send(new ScanCommand({ TableName: TableNames.users }))
      users = (result.Items || []).filter((u) => {
        const uname = ((u['username'] as string) || '').toLowerCase()
        const dname = ((u['displayName'] as string) || '').toLowerCase()
        return uname.includes(q) || dname.includes(q)
      }) as Array<Record<string, unknown>>
    } else {
      throw err
    }
  }

  const filtered = users
    .filter((u) => {
      const uid = (u['userId'] ?? u['id']) as string
      return uid && uid !== viewerId
    })
    .slice(0, 20)

  if (filtered.length === 0) return []

  const userIds = filtered.map((u) => (u['userId'] ?? u['id']) as string)
  const [followingSet, mutualIds] = await Promise.all([
    (async () => {
      const results = await Promise.all(userIds.map((uid) => isFollowing(viewerId, uid).then((r) => [uid, r] as const)))
      return new Set(results.filter(([, r]) => r).map(([uid]) => uid))
    })(),
    getMutualFollowIds(viewerId, userIds),
  ])

  return filtered.map((u) => {
    const uid = (u['userId'] ?? u['id']) as string
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
