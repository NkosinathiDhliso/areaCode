// DynamoDB-backed leaderboard reset worker (replaces Redis + Prisma)
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { generateId } from '../shared/db/entities.js'
import { getNotificationPreferences } from '../features/notifications/repository.js'

async function getCities() {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'CITIES' },
    }),
  )
  return (result.Items || []).map((c) => ({ id: (c['cityId'] ?? c['pk']) as string, slug: c['slug'] as string }))
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
    // 1. Get leaderboard entries from app_data
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `LEADERBOARD#${city.id}` },
        ScanIndexForward: false,
        Limit: 50,
      }),
    )
    const entries = (result.Items || []).map((item, i) => ({
      userId: item['userId'] as string,
      rank: i + 1,
      checkInCount: (item['checkInCount'] as number) ?? 0,
    }))

    // 2. Persist to leaderboard history
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

    // 3. Delete current leaderboard entries
    for (const item of result.Items || []) {
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
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `LEADERBOARD#${city.id}` },
        ScanIndexForward: false,
        Limit: 50,
      }),
    )

    for (let i = 0; i < (result.Items || []).length; i++) {
      const item = result.Items![i]!
      const userId = item['userId'] as string
      const prefs = await getNotificationPreferences(userId)
      if (prefs && prefs['leaderboardPrewarning']) {
        const { emitToast } = await import('../shared/socket/events.js')
        emitToast(city.slug, {
          type: 'leaderboard',
          message: `Ranks reset tonight! You're #${i + 1} with ${item['checkInCount'] ?? 0} check-ins.`,
          nodeId: '',
        })
        sent++
      }
    }
  }

  console.log(`[leaderboard-reset] Pre-reset notifications sent: ${sent}`)
  return { sent }
}
