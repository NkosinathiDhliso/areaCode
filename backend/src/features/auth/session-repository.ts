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

// Sessions reap at roughly the refresh-token lifetime rather than lingering for
// a year. A stale row past this window is dead weight, so the TTL prunes it.
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60 // 90 days

export async function createSession(userId: string, deviceInfo: string): Promise<SessionRecord> {
  // Collapse prior rows for the same device so repeated logins from one
  // browser/device don't pile up as distinct entries in the settings list.
  // Each login still mints a fresh sessionId, but the previous row for that
  // device is retired first.
  try {
    const existing = await listSessions(userId)
    await Promise.all(
      existing.filter((s) => s.deviceInfo === deviceInfo).map((s) => deleteSession(userId, s.sessionId)),
    )
  } catch {
    // Best-effort dedup; never block a login on cleanup failure.
  }

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
