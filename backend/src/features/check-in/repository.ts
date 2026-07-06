// DynamoDB-backed Check-In Repository (replaces Prisma)
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { getTier } from '@area-code/shared/constants/tier-levels'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import * as dynamo from './dynamodb-repository.js'
import { updateUser } from '../auth/dynamodb-repository.js'
import { toSASTDate } from './streak.js'

export async function getNodeWithCity(nodeId: string) {
  const result = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
  if (!result.Item) return null
  const node = result.Item
  // Look up city from app-data if cityId exists
  let city = null
  if (node['cityId']) {
    const cityResult = await documentClient.send(
      new GetCommand({
        TableName: TableNames.appData,
        Key: { pk: `CITY#${node['cityId']}`, sk: `CITY#${node['cityId']}` },
      }),
    )
    city = cityResult.Item ? { id: cityResult.Item['cityId'] ?? node['cityId'], slug: cityResult.Item['slug'] } : null
  }
  return {
    id: node['nodeId'] ?? nodeId,
    lat: node['lat'] as number,
    lng: node['lng'] as number,
    name: node['name'] as string,
    cityId: node['cityId'] as string | null,
    qrCheckinEnabled: node['qrCheckinEnabled'] as boolean,
    businessId: node['businessId'] as string | null,
    city,
  }
}

export async function checkProximity(nodeId: string, lat: number, lng: number, radiusMetres: number): Promise<boolean> {
  // Haversine check since we no longer have PostGIS
  const node = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
  if (!node.Item) return false
  const nodeLat = node.Item['lat'] as number
  const nodeLng = node.Item['lng'] as number
  const R = 6371000 // Earth radius in metres
  const dLat = ((nodeLat - lat) * Math.PI) / 180
  const dLng = ((nodeLng - lng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat * Math.PI) / 180) * Math.cos((nodeLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return distance <= radiusMetres
}

export async function insertCheckIn(data: { userId: string; nodeId: string; type: string; neighbourhoodId?: string }) {
  return dynamo.createCheckIn({
    userId: data.userId,
    nodeId: data.nodeId,
    type: data.type,
    neighbourhoodId: data.neighbourhoodId,
  })
}

// ─── Tier Recalculation ─────────────────────────────────────────────────────
// Tier computation lives in exactly one place: the shared `getTier`
// (`@area-code/shared/constants/tier-levels`). The never-demote guard below
// only ever moves a tier up, never down.

export async function incrementTotalCheckIns(userId: string) {
  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.users,
      Key: { userId },
      UpdateExpression: 'SET totalCheckIns = if_not_exists(totalCheckIns, :zero) + :inc',
      ExpressionAttributeValues: { ':zero': 0, ':inc': 1 },
      ReturnValues: 'ALL_NEW',
    }),
  )
  const totalCheckIns = (result.Attributes?.['totalCheckIns'] as number) ?? 0
  const currentTier = (result.Attributes?.['tier'] as string) ?? 'local'

  const newTier = getTier(totalCheckIns)
  if (newTier !== currentTier) {
    await updateUser(userId, { tier: newTier })
  }

  return { totalCheckIns, tier: newTier }
}

// ─── Streak Tracking ────────────────────────────────────────────────────────
// SAST day math lives in ./streak.ts so the reminder worker and this tracker
// agree on where "today" begins (dry-reuse-no-duplication).

export async function updateStreak(userId: string): Promise<number> {
  const { checkIns } = await dynamo.getCheckInsByUser(userId, { limit: 100 })
  if (checkIns.length === 0) return 0

  // Deduplicate by SAST date
  const days = [...new Set(checkIns.map((c) => toSASTDate(c.checkedInAt)))]

  const now = new Date()
  let streak = 0
  for (let i = 0; i < days.length; i++) {
    const refDate = new Date(now.getTime() + 2 * 60 * 60 * 1000) // SAST
    refDate.setUTCDate(refDate.getUTCDate() - i)
    const expectedDate = refDate.toISOString().slice(0, 10)
    if (days[i] === expectedDate) {
      streak++
    } else {
      break
    }
  }

  await updateUser(userId, { streakCount: streak })
  return streak
}
