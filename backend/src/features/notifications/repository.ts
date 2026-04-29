// DynamoDB-backed Notifications Repository (replaces Prisma)
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

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
