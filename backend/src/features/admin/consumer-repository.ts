// Admin Consumer Repository — consumer management and search
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import {
  getUserById as getDynamoUser,
  updateUser,
} from '../auth/dynamodb-repository.js'
import { getCheckInsByUser } from '../check-in/dynamodb-repository.js'
import { getNodeById } from '../nodes/dynamodb-repository.js'
import { getActivePushTokens, getNotificationPreferences } from '../notifications/repository.js'

export async function getUserById(userId: string) {
  const user = await getDynamoUser(userId)
  if (!user) return null

  const consentResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `CONSENT#${userId}` },
      ScanIndexForward: false,
      Limit: 5,
    }),
  )

  const pushTokens = await getActivePushTokens(userId)
  const notificationPrefs = await getNotificationPreferences(userId)

  return {
    ...user,
    id: user.userId,
    consentRecords: consentResult.Items || [],
    pushTokens,
    notificationPrefs,
  }
}

export async function getUserCheckInHistory(userId: string, take = 50) {
  const { checkIns } = await getCheckInsByUser(userId, { limit: take })
  const enriched = []
  for (const ci of checkIns) {
    const node = await getNodeById(ci.nodeId)
    enriched.push({
      ...ci,
      node: node ? { name: node.name, slug: node.slug } : null,
    })
  }
  return enriched
}

export async function updateUserTier(userId: string, tier: string) {
  return updateUser(userId, { tier })
}

export async function resetAbuseFlags(entityId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      FilterExpression: 'entityId = :eid AND reviewed = :rev',
      ExpressionAttributeValues: { ':pk': 'ABUSE_FLAGS', ':eid': entityId, ':rev': false },
    }),
  )
  let count = 0
  for (const item of result.Items || []) {
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: item['pk'] as string, sk: item['sk'] as string },
        UpdateExpression: 'SET reviewed = :rev',
        ExpressionAttributeValues: { ':rev': true },
      }),
    )
    count++
  }
  return { count }
}

export async function searchConsumers(query: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ALL_USERS' },
      Limit: 200,
    }),
  )
  const allUsers = result.Items || []
  const filtered = query
    ? allUsers.filter((u) => {
        const q = query.toLowerCase()
        const uname = ((u['username'] as string) || '').toLowerCase()
        const phone = (u['phone'] as string) || ''
        const dname = ((u['displayName'] as string) || '').toLowerCase()
        return uname.includes(q) || phone.includes(query) || dname.includes(q)
      })
    : allUsers
  const sliced = filtered.slice(0, 50)

  const enriched = []
  for (const u of sliced) {
    const userId = (u['userId'] ?? u['id']) as string
    const streakCount = (u['streakCount'] as number) ?? 0
    const isDisabled = (u['isDisabled'] as boolean) ?? false

    let abuseFlags = 0
    try {
      const flagsResult = await documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          FilterExpression: 'entityId = :eid AND reviewed = :rev',
          ExpressionAttributeValues: { ':pk': 'ABUSE_FLAGS', ':eid': userId, ':rev': false },
          Select: 'COUNT',
        }),
      )
      abuseFlags = flagsResult.Count ?? 0
    } catch {
      // Non-critical
    }

    enriched.push({
      ...u,
      id: userId,
      streakCount,
      abuseFlags,
      isDisabled,
    })
  }
  return enriched
}
