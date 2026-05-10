// Admin Audit Repository — audit logs, impersonation, messages, consent history
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'

export async function createAuditLog(data: {
  adminId: string
  adminRole: string
  action: string
  entityType: string
  entityId: string
  beforeState?: unknown
  afterState?: unknown
  note?: string
}) {
  const logId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `AUDIT#${logId}`,
    sk: `AUDIT#${now}`,
    gsi1pk: `AUDIT_LOGS`,
    gsi1sk: now,
    logId,
    ...data,
    beforeState: data.beforeState ?? null,
    afterState: data.afterState ?? null,
    createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: logId, ...data, createdAt: now }
}

export async function createImpersonationLog(data: {
  adminId: string
  targetUserId: string
  targetAccountType: string
  note: string
}) {
  const logId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `IMPERSONATION#${logId}`,
    sk: `IMPERSONATION#${now}`,
    logId,
    ...data,
    createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: logId, ...data, createdAt: now }
}

export async function sendAdminMessage(adminId: string, targetUserId: string, message: string) {
  const msgId = generateId()
  const now = new Date().toISOString()
  const item = {
    pk: `ADMIN_MSG#${msgId}`,
    sk: `USER#${targetUserId}`,
    gsi1pk: `USER_MESSAGES#${targetUserId}`,
    gsi1sk: now,
    msgId,
    adminId,
    targetUserId,
    message,
    createdAt: now,
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return { id: msgId, adminId, targetUserId, message, createdAt: now }
}

export async function getUserConsentHistory(userId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `CONSENT#${userId}` },
      ScanIndexForward: false,
    }),
  )
  return result.Items || []
}

export async function getUsersNeedingReconsent(currentVersion: string) {
  const usersResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ALL_USERS' },
      Limit: 200,
    }),
  )
  const needReconsent = []
  for (const u of (usersResult.Items || []).slice(0, 200)) {
    const uid = (u['userId'] ?? u['id']) as string
    const consent = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'consentVersion = :ver',
        ExpressionAttributeValues: { ':pk': `CONSENT#${uid}`, ':ver': currentVersion },
        Limit: 1,
      }),
    )
    if (!consent.Items?.length) {
      needReconsent.push({ id: uid, username: u['username'], phone: u['phone'] })
    }
    if (needReconsent.length >= 100) break
  }
  return needReconsent
}

export async function getAuditLogs(filters: {
  cursor?: string
  adminId?: string
  action?: string
  startDate?: string
  endDate?: string
}) {
  const params: Record<string, unknown> = {
    TableName: TableNames.appData,
    IndexName: 'GSI1',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: { ':pk': 'AUDIT_LOGS' } as Record<string, unknown>,
    ScanIndexForward: false,
    Limit: 50,
  }

  if (filters.startDate && filters.endDate) {
    ;(params as any).KeyConditionExpression += ' AND gsi1sk BETWEEN :start AND :end'
    ;(params as any).ExpressionAttributeValues[':start'] = filters.startDate
    ;(params as any).ExpressionAttributeValues[':end'] = filters.endDate + 'T23:59:59.999Z'
  } else if (filters.startDate) {
    ;(params as any).KeyConditionExpression += ' AND gsi1sk >= :start'
    ;(params as any).ExpressionAttributeValues[':start'] = filters.startDate
  } else if (filters.endDate) {
    ;(params as any).KeyConditionExpression += ' AND gsi1sk <= :end'
    ;(params as any).ExpressionAttributeValues[':end'] = filters.endDate + 'T23:59:59.999Z'
  }

  const filterParts: string[] = []
  if (filters.adminId) {
    filterParts.push('adminId = :adminId')
    ;(params as any).ExpressionAttributeValues[':adminId'] = filters.adminId
  }
  if (filters.action) {
    filterParts.push('#action = :actionFilter')
    ;(params as any).ExpressionAttributeNames = { ...(params as any).ExpressionAttributeNames, '#action': 'action' }
    ;(params as any).ExpressionAttributeValues[':actionFilter'] = filters.action
  }
  if (filterParts.length > 0) {
    ;(params as any).FilterExpression = filterParts.join(' AND ')
  }

  if (filters.cursor) {
    ;(params as any).ExclusiveStartKey = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString())
  }

  const result = await documentClient.send(new QueryCommand(params as any))
  const items = (result.Items || []).map((i) => ({
    id: i['logId'] ?? i['pk'],
    adminId: i['adminId'],
    adminRole: i['adminRole'],
    action: i['action'],
    entityType: i['entityType'],
    entityId: i['entityId'],
    beforeState: i['beforeState'] ?? null,
    afterState: i['afterState'] ?? null,
    createdAt: i['createdAt'],
  }))

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
    : null

  return { items, nextCursor }
}
