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
  const mutuals = new Set<string>()
  for (const cid of candidateIds) {
    const [forward, reverse] = await Promise.all([isFollowing(viewerId, cid), isFollowing(cid, viewerId)])
    if (forward && reverse) mutuals.add(cid)
  }
  return mutuals
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

  // Get recent check-ins from mutual friends via UserIndex
  const allItems: any[] = []
  for (const fid of mutualIds) {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.checkins,
        IndexName: 'UserIndex',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': fid },
        ScanIndexForward: false,
        Limit: limit,
      }),
    )
    for (const ci of result.Items || []) {
      const user = await getUserById(fid)
      const node = await getNodeById(ci['nodeId'] as string)
      allItems.push({
        ...ci,
        checkedInAt: ci['checkedInAt'] as string,
        user: user
          ? {
              id: user.userId,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
              tier: user.tier,
            }
          : null,
        node: node ? { id: node.nodeId, name: node.name, slug: node.slug, category: node.category } : null,
      })
    }
  }

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
      nearbyNodes.push({ nodeId: (n['nodeId'] ?? n['id']) as string, name: n['name'] as string, distance })
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

export async function getLeaderboardTop50(cityId: string) {
  // DynamoDB-backed leaderboard stored in app_data
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
  const top = await getLeaderboardTop50(cityId)
  const entry = top.find((e) => e.userId === userId)
  if (!entry) return null
  return { rank: entry.rank, checkInCount: entry.checkInCount }
}

export async function getUserProfiles(userIds: string[]) {
  if (userIds.length === 0) return []
  const profiles = []
  for (const uid of userIds) {
    const user = await getUserById(uid)
    if (user) {
      profiles.push({
        id: user.userId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        tier: user.tier,
      })
    }
  }
  return profiles
}

// ─── Friends / Following / Followers ────────────────────────────────────────

export async function getMutualFriends(userId: string) {
  const followingIds = await getFollowingIds(userId)
  const mutualIds = await getMutualFollowIds(userId, followingIds)

  const friends = []
  for (const fid of mutualIds) {
    const user = await getUserById(fid)
    if (user) {
      friends.push({
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        tier: user.tier,
        totalCheckIns: (user as any).totalCheckIns ?? 0,
      })
    }
  }
  return friends.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
}

export async function getFollowingList(userId: string) {
  const followingIds = await getFollowingIds(userId)
  const mutualIds = await getMutualFollowIds(userId, followingIds)

  const list = []
  for (const fid of followingIds) {
    const user = await getUserById(fid)
    if (user) {
      list.push({
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        tier: user.tier,
        totalCheckIns: (user as any).totalCheckIns ?? 0,
        isMutual: mutualIds.has(fid),
      })
    }
  }
  return list
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

  const list = []
  for (const fid of followerIds) {
    const user = await getUserById(fid)
    if (user) {
      list.push({
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        tier: user.tier,
        totalCheckIns: (user as any).totalCheckIns ?? 0,
        isFollowingBack: followingBack.has(fid),
      })
    }
  }
  return list
}

export async function searchUsers(query: string, viewerId: string) {
  // Scan users table with filter (no full-text search in DynamoDB)
  const q = query.toLowerCase()
  const result = await documentClient.send(new ScanCommand({ TableName: TableNames.users }))
  const users = (result.Items || [])
    .filter((u) => {
      const uid = (u['userId'] ?? u['id']) as string
      if (uid === viewerId) return false
      const uname = ((u['username'] as string) || '').toLowerCase()
      const dname = ((u['displayName'] as string) || '').toLowerCase()
      return uname.includes(q) || dname.includes(q)
    })
    .slice(0, 20)

  const userIds = users.map((u) => (u['userId'] ?? u['id']) as string)
  const followingSet = new Set<string>()
  for (const uid of userIds) {
    if (await isFollowing(viewerId, uid)) followingSet.add(uid)
  }
  const mutualIds = userIds.length > 0 ? await getMutualFollowIds(viewerId, userIds) : new Set<string>()

  return users.map((u) => {
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
