// DynamoDB-backed Notifications Repository (replaces Prisma)
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'

// ============================================================================
// NOTIFICATION HISTORY
// ============================================================================

export interface NotificationRecord {
  notifId: string
  userId: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  isRead: boolean
  deliveryChannel: 'socket' | 'push' | 'none'
  createdAt: string
}

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60

export async function persistNotification(
  notification: Omit<NotificationRecord, 'notifId' | 'isRead' | 'createdAt'>,
): Promise<NotificationRecord> {
  const notifId = generateId()
  const createdAt = new Date().toISOString()
  const ttl = Math.floor(Date.now() / 1000) + NINETY_DAYS_SECONDS

  const record: NotificationRecord = {
    notifId,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    isRead: false,
    deliveryChannel: notification.deliveryChannel,
    createdAt,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `NOTIF#${notification.userId}`,
        sk: `NOTIF#${createdAt}#${notifId}`,
        ...record,
        ttl,
      },
    }),
  )

  return record
}

export async function getNotificationHistory(
  userId: string,
  options?: { limit?: number; cursor?: string },
): Promise<{ notifications: NotificationRecord[]; nextCursor?: string }> {
  const limit = options?.limit || 20

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `NOTIF#${userId}`,
        ':prefix': 'NOTIF#',
      },
      ScanIndexForward: false,
      Limit: limit,
      ...(options?.cursor
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(options.cursor, 'base64').toString()) }
        : {}),
    }),
  )

  const notifications: NotificationRecord[] = (result.Items || []).map((item) => ({
    notifId: item['notifId'] as string,
    userId: item['userId'] as string,
    type: item['type'] as string,
    title: item['title'] as string,
    body: item['body'] as string,
    data: (item['data'] as Record<string, unknown>) ?? {},
    isRead: (item['isRead'] as boolean) ?? false,
    deliveryChannel: (item['deliveryChannel'] as 'socket' | 'push' | 'none') ?? 'none',
    createdAt: item['createdAt'] as string,
  }))

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { notifications, nextCursor }
}

export async function markNotificationsAsRead(userId: string): Promise<{ updatedCount: number }> {
  // Query all unread notifications for the user
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: 'isRead = :unread',
      ExpressionAttributeValues: {
        ':pk': `NOTIF#${userId}`,
        ':prefix': 'NOTIF#',
        ':unread': false,
      },
    }),
  )

  const items = result.Items || []
  let updatedCount = 0

  // Batch update each unread notification
  for (const item of items) {
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: item['pk'] as string, sk: item['sk'] as string },
        UpdateExpression: 'SET isRead = :read',
        ExpressionAttributeValues: { ':read': true },
      }),
    )
    updatedCount++
  }

  return { updatedCount }
}

export async function upsertPushToken(
  userId: string,
  token: string,
  platform: string,
  deviceId?: string,
) {
  const now = new Date().toISOString()
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `USER_TOKEN#${userId}`,
        sk: `TOKEN#${token}`,
        userId, token, platform, deviceId,
        isActive: true,
        lastUsedAt: now,
        createdAt: now,
      },
    })
  )
  return { userId, token, platform, deviceId, isActive: true, lastUsedAt: now }
}

export async function getNotificationPreferences(userId: string) {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: `NOTIF_PREFS#${userId}`, sk: `NOTIF_PREFS#${userId}` },
    })
  )
  return result.Item ?? null
}

export async function upsertNotificationPreferences(
  userId: string,
  prefs: Partial<{
    streakAtRisk: boolean
    rewardActivated: boolean
    rewardClaimedPush: boolean
    leaderboardPrewarning: boolean
    followedUserCheckin: boolean
  }>,
) {
  const now = new Date().toISOString()
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `NOTIF_PREFS#${userId}`,
        sk: `NOTIF_PREFS#${userId}`,
        userId,
        ...prefs,
        updatedAt: now,
      },
    })
  )
  return { userId, ...prefs, updatedAt: now }
}

export async function getActivePushTokens(userId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':pk': `USER_TOKEN#${userId}`,
        ':prefix': 'TOKEN#',
        ':active': true,
      },
    })
  )
  return result.Items ?? []
}

export async function deactivatePushToken(userId: string, token: string) {
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: `USER_TOKEN#${userId}`, sk: `TOKEN#${token}` },
      UpdateExpression: 'SET isActive = :inactive',
      ExpressionAttributeValues: { ':inactive': false },
    })
  )
  return { count: 1 }
}
