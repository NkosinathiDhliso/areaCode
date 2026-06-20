// DynamoDB-backed pulse decay worker (replaces Redis + Prisma)
import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { kvGet, kvSet, kvDel } from '../shared/kv/dynamodb-kv.js'
import { emitStateChange } from '../shared/socket/events.js'

/**
 * Pulse decay worker , EventBridge Lambda every 5 minutes.
 * Applies time-weighted decay to all node pulse scores.
 * Off-peak (00:00–17:59 SAST): score × 0.90
 * Peak (18:00–23:59 SAST): score × 0.95
 * Floor: 0
 */

const STATE_THRESHOLDS = [
  { min: 61, state: 'popping' },
  { min: 31, state: 'buzzing' },
  { min: 11, state: 'active' },
  { min: 1, state: 'quiet' },
  { min: 0, state: 'dormant' },
] as const

function getNodeState(score: number): string {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}

/**
 * Single source of truth for the SAST (UTC+2) peak-hour boundary: 18:00–23:59.
 * Used by pulse decay (decay factor) and by presence expiry (Expiry_Window).
 * @param now - the moment to evaluate; defaults to the current time.
 */
export function isPeakHour(now: Date = new Date()): boolean {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000) // UTC+2
  const hour = sast.getUTCHours()
  return hour >= 18 && hour <= 23
}

async function getCities() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND sk = pk',
      ExpressionAttributeValues: { ':prefix': 'CITY#' },
    }),
  )
  return (result.Items || []).map((c) => ({ id: (c['cityId'] ?? c['pk']) as string, slug: c['slug'] as string }))
}

export async function handler() {
  console.log('[pulse-decay] Starting pulse decay worker')
  const decayFactor = isPeakHour() ? 0.95 : 0.9

  const cities = await getCities()
  let totalProcessed = 0

  for (const city of cities) {
    // Get all active nodes for this city
    const nodesResult = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.nodes,
        FilterExpression: 'cityId = :cityId AND isActive = :active',
        ExpressionAttributeValues: { ':cityId': city.id, ':active': true },
      }),
    )

    for (const n of nodesResult.Items || []) {
      const nodeId = (n['nodeId'] ?? n['id']) as string
      const scoreStr = await kvGet(`pulse:${city.id}:${nodeId}`)
      if (!scoreStr) continue

      const currentScore = parseFloat(scoreStr)
      if (currentScore <= 0) continue

      const oldState = getNodeState(currentScore)
      const newScore = Math.floor(currentScore * decayFactor)
      const newState = getNodeState(newScore)

      if (newScore <= 0) {
        await kvDel(`pulse:${city.id}:${nodeId}`)
      } else {
        await kvSet(`pulse:${city.id}:${nodeId}`, String(newScore), 86400)
      }

      if (oldState !== newState) {
        emitStateChange(city.slug, {
          nodeId,
          state: newState as 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping',
        })
      }

      totalProcessed++
    }
  }

  console.log(`[pulse-decay] Processed ${totalProcessed} nodes`)
  return { processed: totalProcessed }
}
