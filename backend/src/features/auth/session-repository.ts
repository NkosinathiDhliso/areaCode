import { PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'

export interface SessionRecord {
  sessionId: string
  deviceInfo: string
  createdAt: string
  lastActiveAt: string
  isCurrent: boolean
}

const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60 // 365 days

export async function createSession(userId: string, deviceInfo: string): Promise<SessionRecord> {
  const sessionId = generateId()
  const now = new Date().toISOString()
  const ttl = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `SESSION#${userId}`,
        sk: `SESSION#${sessionId}`,
        sessionId,
        deviceInfo,
        createdAt: now,
        lastActiveAt: now,
        isCurrent: false,
        ttl,
      },
    }),
  )

  return { sessionId, deviceInfo, createdAt: now, lastActiveAt: now, isCurrent: false }
}

export async function listSessions(userId: string): Promise<SessionRecord[]> {
  const now = Math.floor(Date.now() / 1000)
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${userId}`,
        ':skPrefix': 'SESSION#',
      },
      ScanIndexForward: false,
    }),
  )

  return (result.Items ?? [])
    .filter((item) => !item['ttl'] || (item['ttl'] as number) > now)
    .map((item) => ({
      sessionId: item['sessionId'] as string,
      deviceInfo: item['deviceInfo'] as string,
      createdAt: item['createdAt'] as string,
      lastActiveAt: item['lastActiveAt'] as string,
      isCurrent: (item['isCurrent'] as boolean) ?? false,
    }))
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: {
        pk: `SESSION#${userId}`,
        sk: `SESSION#${sessionId}`,
      },
    }),
  )
}

export async function deleteAllSessionsExcept(userId: string, currentSessionId: string): Promise<number> {
  const sessions = await listSessions(userId)
  const toDelete = sessions.filter((s) => s.sessionId !== currentSessionId)

  await Promise.all(toDelete.map((s) => deleteSession(userId, s.sessionId)))

  return toDelete.length
}

export async function touchSession(userId: string, sessionId: string): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: {
        pk: `SESSION#${userId}`,
        sk: `SESSION#${sessionId}`,
      },
      UpdateExpression: 'SET lastActiveAt = :now',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
      },
    }),
  )
}
