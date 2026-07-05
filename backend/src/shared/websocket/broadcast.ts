// WebSocket Broadcast Helper for Backend Lambdas
// Allows any Lambda function to broadcast real-time events to connected clients

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, QueryCommand as DocQueryCommand } from '@aws-sdk/lib-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

import { AWS_REGION, requireEnv } from '../config/env.js'
import { documentClient } from '../db/dynamodb.js'

const ddbClient = new DynamoDBClient({ region: AWS_REGION })

// WebSocket API endpoint from environment
const WEBSOCKET_ENDPOINT = process.env['WEBSOCKET_ENDPOINT']
const CONNECTIONS_TABLE = requireEnv('CONNECTIONS_TABLE', 'area-code-dev-websocket-connections')

interface BroadcastMessage {
  type: string
  payload: Record<string, unknown>
}

async function getApiClient(): Promise<ApiGatewayManagementApiClient> {
  const endpoint = WEBSOCKET_ENDPOINT
  if (!endpoint) {
    throw new Error('WEBSOCKET_ENDPOINT environment variable not set')
  }

  return new ApiGatewayManagementApiClient({
    region: AWS_REGION,
    endpoint,
  })
}

export async function sendToConnection(connectionId: string, message: BroadcastMessage): Promise<void> {
  const client = await getApiClient()

  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message),
      }),
    )
  } catch (error: any) {
    if (error.name === 'GoneException') {
      // Connection is stale - ignore, it'll be cleaned up by TTL
      console.log(`Connection ${connectionId} is gone`)
    } else {
      throw error
    }
  }
}

// ============================================================================
// BROADCAST FUNCTIONS
// ============================================================================

/**
 * Broadcast a message to all connections in a room (e.g., city:capetown).
 * Returns the number of connections the message was fanned out to.
 */
export async function broadcastToRoom(roomId: string, message: BroadcastMessage): Promise<number> {
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'RoomIndex',
      KeyConditionExpression: 'roomId = :roomId',
      ExpressionAttributeValues: {
        ':roomId': { S: roomId },
      },
    }),
  )

  const connections = result.Items?.map((item) => unmarshall(item)) || []

  await Promise.all(connections.map((conn) => sendToConnection(conn.connectionId, message)))

  console.log(`Broadcasted to ${connections.length} connections in room ${roomId}`)
  return connections.length
}

/**
 * Broadcast a message to all connections for a specific user.
 * Returns the number of connections the message was fanned out to, so callers
 * can fall back to push delivery when the user has no live socket.
 */
export async function broadcastToUser(userId: string, message: BroadcastMessage): Promise<number> {
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': { S: userId },
      },
    }),
  )

  const connections = result.Items?.map((item) => unmarshall(item)) || []

  await Promise.all(connections.map((conn) => sendToConnection(conn.connectionId, message)))

  console.log(`Broadcasted to ${connections.length} connections for user ${userId}`)
  return connections.length
}

/**
 * Count live connections in a room without sending anything. Used to defer
 * expensive emits when nobody is listening (e.g. live-archetype ticks).
 */
export async function countRoomConnections(roomId: string): Promise<number> {
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'RoomIndex',
      KeyConditionExpression: 'roomId = :roomId',
      ExpressionAttributeValues: {
        ':roomId': { S: roomId },
      },
      Select: 'COUNT',
    }),
  )
  return result.Count ?? 0
}

/**
 * Delete every websocket-connections row belonging to a user, paginating over
 * the UserIndex GSI's LastEvaluatedKey so no rows are missed. Used by the POPIA
 * erasure processor (workers/cleanup.ts) so no personal data (userId) survives
 * in the connections table. The table's primary key is `connectionId`, which
 * the UserIndex GSI carries, so each row can be addressed for deletion. Uses
 * `documentClient` (no manual marshall) for consistency with the erasure
 * worker's other deletions. Returns the number of rows deleted.
 */
export async function deleteConnectionsByUser(userId: string): Promise<number> {
  let deleted = 0
  let cursor: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new DocQueryCommand({
        TableName: CONNECTIONS_TABLE,
        IndexName: 'UserIndex',
        KeyConditionExpression: 'userId = :userId',
        ProjectionExpression: 'connectionId',
        ExpressionAttributeValues: { ':userId': userId },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )

    for (const item of result.Items || []) {
      await documentClient.send(
        new DeleteCommand({
          TableName: CONNECTIONS_TABLE,
          Key: { connectionId: item['connectionId'] as string },
        }),
      )
      deleted++
    }

    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)

  return deleted
}

// Event-shaped emitters (pulse updates, toasts, reward events, ...) live in
// one home: backend/src/shared/socket/events.ts. They delegate to
// broadcastToRoom / broadcastToUser above.
