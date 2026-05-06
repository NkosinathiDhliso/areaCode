// DynamoDB-backed cleanup worker (replaces Prisma)
import { ScanCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { deleteUser } from '../features/auth/dynamodb-repository.js'

/**
 * Cleanup worker , processes right-to-erasure queue + housekeeping.
 * Runs daily via EventBridge.
 * DynamoDB TTL handles most expiration automatically; this worker
 * processes explicit erasure requests and cleans orphaned data.
 */
export async function handler() {
  console.log('[cleanup] Starting cleanup worker')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // ─── Process erasure requests older than 30 days ──────────────────────
  const erasureResult = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND #status = :pending AND requestedAt < :cutoff',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':prefix': 'ERASURE#', ':pending': 'pending', ':cutoff': thirtyDaysAgo },
    }),
  )

  let erasedCount = 0
  for (const req of erasureResult.Items || []) {
    const userId = req['userId'] as string
    try {
      // Delete user from users table
      if (userId) await deleteUser(userId)

      // Delete related app_data items (follows, tokens, prefs, etc.)
      const userItems = await documentClient.send(
        new ScanCommand({
          TableName: TableNames.appData,
          FilterExpression: 'contains(pk, :uid) OR contains(sk, :uid)',
          ExpressionAttributeValues: { ':uid': userId },
        }),
      )
      for (const item of userItems.Items || []) {
        await documentClient.send(
          new DeleteCommand({
            TableName: TableNames.appData,
            Key: { pk: item['pk'] as string, sk: item['sk'] as string },
          }),
        )
      }

      // Mark erasure as completed
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.appData,
          Key: { pk: req['pk'] as string, sk: req['sk'] as string },
          UpdateExpression: 'SET #status = :completed, processedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':completed': 'completed', ':now': new Date().toISOString() },
        }),
      )
      erasedCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cleanup] Erasure failed for user ${userId}: ${msg}`)
    }
  }

  // ─── Expired staff invites and old webhooks are handled by DynamoDB TTL ──

  console.log(`[cleanup] Erased: ${erasedCount}`)
  return { erasedCount, expiredInvites: 0, oldWebhooks: 0 }
}
