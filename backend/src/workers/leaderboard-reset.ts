// DynamoDB-backed leaderboard reset worker (replaces Redis + Prisma)
import { QueryCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { generateId } from '../shared/db/entities.js'
import { getNotificationPreferences } from '../features/notifications/repository.js'

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

interface RankedLeaderboardEntry {
  userId: string
  checkInCount: number
  rank: number
}

/**
 * Read ALL leaderboard entries for a city from the canonical key
 * (`pk=LEADERBOARD#{cityId}`), paginating over every page. No Limit cap:
 * lower-ranked entries beyond the first page must be included too.
 */
async function readAllLeaderboardItems(cityId: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []
  let lastEvaluatedKey: Record<string, unknown> | undefined
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `LEADERBOARD#${cityId}` },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    )
    items.push(...((page.Items ?? []) as Record<string, unknown>[]))
    lastEvaluatedKey = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastEvaluatedKey)
  return items
}

/**
 * Rank raw leaderboard items by checkInCount desc with a deterministic userId
 * tiebreak, assigning 1-based ranks. Shared by the reset and pre-reset paths so
 * the ranked users a pre-reset notification warns match what the reset archives.
 */
function rankLeaderboardEntries(items: Record<string, unknown>[]): RankedLeaderboardEntry[] {
  return items
    .map((item) => ({
      userId: item['userId'] as string,
      checkInCount: (item['checkInCount'] as number) ?? 0,
    }))
    .sort((a, b) => b.checkInCount - a.checkInCount || a.userId.localeCompare(b.userId))
    .map((e, i) => ({ ...e, rank: i + 1 }))
}

/**
 * Leaderboard reset worker , EventBridge Lambda Monday 00:00 SAST.
 */
export async function handler() {
  console.log('[leaderboard-reset] Starting weekly leaderboard reset')

  const cities = await getCities()
  const weekEnding = new Date().toISOString()
  let totalEntries = 0

  for (const city of cities) {
    // 1. Get ALL leaderboard entries for the city (paginated, canonical key),
    //    then rank across the full set.
    const items = await readAllLeaderboardItems(city.id)
    const entries = rankLeaderboardEntries(items)

    // 2. Archive every entry to leaderboard history.
    for (const e of entries) {
      await documentClient.send(
        new PutCommand({
          TableName: TableNames.appData,
          Item: {
            pk: `LB_HISTORY#${city.id}`,
            sk: `${weekEnding}#${e.userId}`,
            cityId: city.id,
            weekEnding,
            userId: e.userId,
            rank: e.rank,
            checkInCount: e.checkInCount,
          },
        }),
      )
    }

    // 3. Delete every current leaderboard entry.
    for (const item of items) {
      await documentClient.send(
        new DeleteCommand({
          TableName: TableNames.appData,
          Key: { pk: item['pk'] as string, sk: item['sk'] as string },
        }),
      )
    }

    totalEntries += entries.length
    console.log(`[leaderboard-reset] ${city.slug}: ${entries.length} entries persisted`)
  }

  console.log(`[leaderboard-reset] Total entries: ${totalEntries}`)
  return { totalEntries }
}

/**
 * Pre-reset notification , EventBridge Lambda Sunday 20:00 SAST.
 */
export async function preResetHandler() {
  console.log('[leaderboard-reset] Sending pre-reset notifications')

  const cities = await getCities()
  let sent = 0

  for (const city of cities) {
    // Same paginated read + rank as the reset handler (shared helpers), so the
    // ranked users we warn match exactly what the reset will archive.
    const items = await readAllLeaderboardItems(city.id)
    const entries = rankLeaderboardEntries(items)

    for (const entry of entries) {
      const prefs = await getNotificationPreferences(entry.userId)
      if (prefs && prefs['leaderboardPrewarning']) {
        const { emitToast } = await import('../shared/socket/events.js')
        emitToast(city.slug, {
          type: 'leaderboard',
          message: `Ranks reset tonight! You're #${entry.rank} with ${entry.checkInCount} check-ins.`,
          nodeId: '',
        })
        sent++
      }
    }
  }

  console.log(`[leaderboard-reset] Pre-reset notifications sent: ${sent}`)
  return { sent }
}
