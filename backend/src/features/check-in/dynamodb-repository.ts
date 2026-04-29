// DynamoDB Repository for Check-In Feature
import {
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import type { CheckIn } from './types.js'

// ============================================================================
// CHECK-IN OPERATIONS
// ============================================================================

export async function getCheckInById(checkInId: string): Promise<CheckIn | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.checkins,
      Key: { pk: `CHECKIN#${checkInId}`, sk: `CHECKIN#${checkInId}` },
    })
  )
  return result.Item ? (result.Item as CheckIn) : null
}

export async function createCheckIn(
  data: Omit<CheckIn, 'checkInId' | 'checkedInAt'>
): Promise<CheckIn> {
  const checkInId = generateId()
  const now = new Date().toISOString()

  const checkIn: CheckIn = {
    ...data,
    checkInId,
    checkedInAt: now,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.checkins,
      Item: {
        pk: `CHECKIN#${checkInId}`,
        sk: `CHECKIN#${checkInId}`,
        // GSI1 for user queries
        gsi1pk: `USER#${data.userId}`,
        gsi1sk: now,
        // GSI2 for node queries
        gsi2pk: `NODE#${data.nodeId}`,
        gsi2sk: now,
        ...checkIn,
      },
    })
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
  }
): Promise<{ checkIns: CheckIn[]; nextCursor?: string }> {
  let keyCondition = 'gsi1pk = :userId'
  const exprValues: Record<string, unknown> = { ':userId': `USER#${userId}` }
  let filterExpr = ''

  if (options?.startTime && options?.endTime) {
    keyCondition += ' AND gsi1sk BETWEEN :start AND :end'
    exprValues[':start'] = options.startTime
    exprValues[':end'] = options.endTime
  }

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: exprValues,
      ScanIndexForward: false,
      Limit: options?.limit || 50,
      ...(options?.cursor
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(options.cursor, 'base64').toString()) }
        : {}),
    })
  )

  const checkIns = (result.Items || []) as CheckIn[]
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
  }
): Promise<{ checkIns: CheckIn[]; nextCursor?: string }> {
  let filterExpr = ''
  const exprValues: Record<string, unknown> = { ':nodeId': `NODE#${nodeId}` }

  if (options?.hours) {
    const cutoff = new Date(Date.now() - options.hours * 60 * 60 * 1000).toISOString()
    filterExpr = 'checkedInAt >= :cutoff'
    exprValues[':cutoff'] = cutoff
  }

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'NodeIndex',
      KeyConditionExpression: 'gsi2pk = :nodeId',
      ExpressionAttributeValues: exprValues,
      ...(filterExpr ? { FilterExpression: filterExpr } : {}),
      ScanIndexForward: false,
      Limit: options?.limit || 50,
      ...(options?.cursor
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(options.cursor, 'base64').toString()) }
        : {}),
    })
  )

  const checkIns = (result.Items || []) as CheckIn[]
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { checkIns, nextCursor }
}

export async function getRecentCheckInCount(
  userId: string,
  nodeId: string,
  hours: number
): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'gsi1pk = :userId',
      FilterExpression: 'nodeId = :nodeId AND checkedInAt >= :cutoff',
      ExpressionAttributeValues: {
        ':userId': `USER#${userId}`,
        ':nodeId': nodeId,
        ':cutoff': cutoff,
      },
    })
  )

  return result.Count || 0
}

export async function getUserCheckInCount(userId: string): Promise<number> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'gsi1pk = :userId',
      ExpressionAttributeValues: { ':userId': `USER#${userId}` },
      Select: 'COUNT',
    })
  )

  return result.Count || 0
}

// ============================================================================
// LEADERBOARD
// ============================================================================

export async function getLeaderboard(
  cityId: string,
  weekEnding: string,
  limit: number = 100
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
    })
  )

  return (result.Items || []).map((item: { userId: string; rank?: number; checkInCount: number }, index: number) => ({
    userId: item.userId,
    rank: item.rank || index + 1,
    checkInCount: item.checkInCount,
  }))
}

export async function updateLeaderboardEntry(
  cityId: string,
  weekEnding: string,
  userId: string,
  checkInCount: number,
  rank: number
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
    })
  )
}

// ============================================================================
// ABUSE DETECTION
// ============================================================================

export async function getCheckInVelocity(
  userId: string,
  minutes: number
): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.checkins,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'gsi1pk = :userId AND gsi1sk >= :cutoff',
      ExpressionAttributeValues: {
        ':userId': `USER#${userId}`,
        ':cutoff': cutoff,
      },
    })
  )

  return result.Count || 0
}

export async function markCheckInForDeletion(checkInId: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 86400 // 1 day from now

  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.checkins,
      Key: { pk: `CHECKIN#${checkInId}`, sk: `CHECKIN#${checkInId}` },
      UpdateExpression: 'SET #deleted = :deleted, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#deleted': 'deleted',
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':deleted': true,
        ':ttl': ttl,
      },
    })
  )
}
