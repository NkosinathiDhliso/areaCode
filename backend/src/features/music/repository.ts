// DynamoDB-backed Music Repository (replaces Prisma)
import { QueryCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { updateUser, getUserById } from '../auth/dynamodb-repository.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'

export async function updateUserGenres(
  userId: string,
  musicGenres: string[],
  dimensionScores: Record<string, number> | null,
  archetypeId: string,
) {
  const updated = await updateUser(userId, {
    musicGenres,
    dimensionScores,
    archetypeId,
    genresUpdatedAt: new Date().toISOString(),
  } as any)
  return updated ? { id: updated.userId, musicGenres, dimensionScores, archetypeId } : null
}

export async function updateStreamingProvider(userId: string, provider: string | null) {
  const updated = await updateUser(userId, { streamingProvider: provider } as any)
  return updated ? { id: updated.userId, streamingProvider: provider } : null
}

export async function clearUserMusicData(userId: string) {
  return updateUser(userId, {
    streamingProvider: null,
    musicGenres: [],
    dimensionScores: null,
    archetypeId: null,
  } as any)
}

export async function getCrowdVibeData(nodeId: string) {
  const { checkIns } = await getCheckInsByNode(nodeId, { hours: 1 })
  // Deduplicate by userId and enrich
  const seen = new Set<string>()
  const users = []
  for (const ci of checkIns) {
    if (seen.has(ci.userId)) continue
    seen.add(ci.userId)
    const user = await getUserById(ci.userId)
    if (user) {
      users.push({
        id: user.userId,
        musicGenres: (user as any).musicGenres ?? [],
        dimensionScores: (user as any).dimensionScores ?? null,
        archetypeId: (user as any).archetypeId ?? null,
      })
    }
  }
  return users
}

export async function getBusinessAudienceMusicData(businessId: string) {
  // Get nodes for business
  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodeIds = (nodesResult.Items || []).map((n) => n['nodeId'] as string)

  const seen = new Set<string>()
  const users = []
  for (const nid of nodeIds) {
    const { checkIns } = await getCheckInsByNode(nid, { hours: 720 }) // ~30 days
    for (const ci of checkIns) {
      if (seen.has(ci.userId)) continue
      seen.add(ci.userId)
      const user = await getUserById(ci.userId)
      if (user) {
        users.push({
          id: user.userId,
          musicGenres: (user as any).musicGenres ?? [],
          dimensionScores: (user as any).dimensionScores ?? null,
          archetypeId: (user as any).archetypeId ?? null,
        })
      }
    }
  }
  return users
}
