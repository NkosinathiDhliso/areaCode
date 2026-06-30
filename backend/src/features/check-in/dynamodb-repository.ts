// DynamoDB Repository for Check-In Feature
import { GetCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import type { CheckIn } from './types.js'

// ============================================================================
// CHECK-IN OPERATIONS
// ============================================================================

export async function getCheckInById(checkInId: string, timestamp?: number): Promise<CheckIn | null> {
  if (timestamp !== undefined) {
    const result = await documentClient.send(
      new GetCommand({
        TableName: TableNames.checkins,
        Key: { checkInId, timestamp },
      }),
    )
    return result.Item ? mapCheckIn(result.Item) : null
  }
  // Without timestamp, query by checkInId (partition key only)
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      KeyConditionExpression: 'checkInId = :id',
      ExpressionAttributeValues: { ':id': checkInId },
      Limit: 1,
    }),
  )
  return result.Items?.[0] ? mapCheckIn(result.Items[0]) : null
}

export async function createCheckIn(data: Omit<CheckIn, 'checkInId' | 'checkedInAt'>): Promise<CheckIn> {
  const checkInId = generateId()
  const now = new Date().toISOString()
  const ts = Date.now() // numeric timestamp for SK

  const checkIn: CheckIn = {
    ...data,
    checkInId,
    checkedInAt: now,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.checkins,
      Item: {
        ...checkIn,
        timestamp: ts,
      },
    }),
  )

  return checkIn
}

export async function getCheckInsByUser(
  userId: string,
  options?: {
    limit?: number
    cursor?: string
    startTime?: string
    endTime?: string
  },
): Promise<{ checkIns: CheckIn[]; nextCursor?: string }> {
  let keyCondition = 'userId = :userId'
  const exprValues: Record<string, unknown> = { ':userId': userId }

  if (options?.startTime && options?.endTime) {
    keyCondition += ' AND #ts BETWEEN :start AND :end'
    exprValues[':start'] = new Date(options.startTime).getTime()
    exprValues[':end'] = new Date(options.endTime).getTime()
  }

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: keyCondition,
      ...(options?.startTime ? { ExpressionAttributeNames: { '#ts': 'timestamp' } } : {}),
      ExpressionAttributeValues: exprValues,
      ScanIndexForward: false,
      Limit: options?.limit || 50,
      ...(options?.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(options.cursor, 'base64').toString()) } : {}),
    }),
  )

  const checkIns = (result.Items || []).map((i) => mapCheckIn(i))
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { checkIns, nextCursor }
}

export async function getCheckInsByNode(
  nodeId: string,
  options?: {
    limit?: number
    cursor?: string
    hours?: number
  },
): Promise<{ checkIns: CheckIn[]; nextCursor?: string }> {
  let filterExpr = ''
  const exprValues: Record<string, unknown> = { ':nodeId': nodeId }

  if (options?.hours) {
    const cutoff = new Date(Date.now() - options.hours * 60 * 60 * 1000).toISOString()
    filterExpr = 'checkedInAt >= :cutoff'
    exprValues[':cutoff'] = cutoff
  }

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'NodeIndex',
      KeyConditionExpression: 'nodeId = :nodeId',
      ExpressionAttributeValues: exprValues,
      ...(filterExpr ? { FilterExpression: filterExpr } : {}),
      ScanIndexForward: false,
      Limit: options?.limit || 50,
      ...(options?.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(options.cursor, 'base64').toString()) } : {}),
    }),
  )

  const checkIns = (result.Items || []).map((i) => mapCheckIn(i))
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { checkIns, nextCursor }
}

export async function getRecentCheckInCount(userId: string, nodeId: string, hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'nodeId = :nodeId AND checkedInAt >= :cutoff',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':nodeId': nodeId,
        ':cutoff': cutoff,
      },
    }),
  )

  return result.Count || 0
}

export async function getUserCheckInCountAtNode(userId: string, nodeId: string): Promise<number> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'nodeId = :nodeId',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':nodeId': nodeId,
      },
      Select: 'COUNT',
    }),
  )

  return result.Count || 0
}

export async function getUserCheckInCount(userId: string): Promise<number> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      Select: 'COUNT',
    }),
  )

  return result.Count || 0
}

// ============================================================================
// LEADERBOARD
// ============================================================================

export async function getLeaderboard(
  cityId: string,
  weekEnding: string,
  limit: number = 100,
): Promise<Array<{ userId: string; rank: number; checkInCount: number }>> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `LEADERBOARD#${cityId}#${weekEnding}`,
      },
      ScanIndexForward: true,
      Limit: limit,
    }),
  )

  return (result.Items || []).map((item, index) => ({
    userId: item['userId'] as string,
    rank: (item['rank'] as number) || index + 1,
    checkInCount: (item['checkInCount'] as number) ?? 0,
  }))
}

export async function updateLeaderboardEntry(
  cityId: string,
  weekEnding: string,
  userId: string,
  checkInCount: number,
  rank: number,
): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `LEADERBOARD#${cityId}#${weekEnding}`,
        sk: `RANK#${rank.toString().padStart(4, '0')}#${userId}`,
        userId,
        checkInCount,
        rank,
        cityId,
        weekEnding,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
}

// ============================================================================
// ABUSE DETECTION
// ============================================================================

export async function getCheckInVelocity(userId: string, minutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'checkedInAt >= :cutoff',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':cutoff': cutoff,
      },
    }),
  )

  return result.Count || 0
}

export async function markCheckInForDeletion(checkInId: string): Promise<void> {
  // Need timestamp to address the item , query first
  const item = await getCheckInById(checkInId)
  if (!item) return
  const ts = (item as unknown as Record<string, unknown>)['timestamp'] as number
  const ttl = Math.floor(Date.now() / 1000) + 86400 // 1 day from now

  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.checkins,
      Key: { checkInId, timestamp: ts },
      UpdateExpression: 'SET #deleted = :deleted, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#deleted': 'deleted',
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':deleted': true,
        ':ttl': ttl,
      },
    }),
  )
}

function mapCheckIn(item: Record<string, unknown>): CheckIn {
  return {
    checkInId: item['checkInId'] as string,
    userId: item['userId'] as string,
    nodeId: item['nodeId'] as string,
    neighbourhoodId: item['neighbourhoodId'] as string | undefined,
    type: item['type'] as string,
    checkedInAt: item['checkedInAt'] as string,
  }
}
