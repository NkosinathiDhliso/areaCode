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

async function sendToConnection(connectionId: string, message: BroadcastMessage): Promise<void> {
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
 * Broadcast a message to all connections in a room (e.g., city:capetown)
 */
export async function broadcastToRoom(roomId: string, message: BroadcastMessage): Promise<void> {
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
}

/**
 * Broadcast a message to all connections for a specific user
 */
export async function broadcastToUser(userId: string, message: BroadcastMessage): Promise<void> {
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

/**
 * Broadcast a pulse update to all users in a city
 */
export async function broadcastPulseUpdate(
  citySlug: string,
  nodeId: string,
  pulseScore: number,
  state: string,
  checkInCount: number,
): Promise<void> {
  await broadcastToRoom(`city:${citySlug}`, {
    type: 'node:pulse_update',
    payload: {
      nodeId,
      pulseScore,
      state,
      checkInCount,
    },
  })
}

/**
 * Broadcast the honest live-presence count for a venue to all users in a city
 * over the existing API Gateway WebSocket transport (no new transport).
 *
 * Dedicated `node:presence_update` event carrying only `{ nodeId,
 * livePresenceCount, cause }` — no consumer identity (Requirements 7.4, 10.4).
 * Does NOT repurpose `node:pulse_update.checkInCount` (founder decision 13.4 /
 * Requirement 8.4). Best-effort fan-out: callers wrap this so a failure is
 * logged and never rolls back the committed check-in / check-out / expiry
 * (Requirement 7.5).
 */
export async function broadcastPresenceUpdate(
  citySlug: string,
  nodeId: string,
  livePresenceCount: number,
  cause: 'check_in' | 'check_out' | 'expiry',
): Promise<void> {
  await broadcastToRoom(`city:${citySlug}`, {
    type: 'node:presence_update',
    payload: {
      nodeId,
      livePresenceCount,
      cause,
    },
  })
}

/**
 * Broadcast a state surge (e.g., quiet -> active)
 */
export async function broadcastStateSurge(
  citySlug: string,
  nodeId: string,
  fromState: string,
  toState: string,
): Promise<void> {
  await broadcastToRoom(`city:${citySlug}`, {
    type: 'node:state_surge',
    payload: {
      nodeId,
      fromState,
      toState,
    },
  })
}

/**
 * Broadcast a toast notification
 */
export async function broadcastToast(
  citySlug: string,
  toast: {
    type: string
    message: string
    nodeId?: string
    nodeLat?: number
    nodeLng?: number
    avatarUrl?: string
  },
): Promise<void> {
  await broadcastToRoom(`city:${citySlug}`, {
    type: 'toast:new',
    payload: toast,
  })
}

/**
 * Broadcast reward claimed notification
 */
export async function broadcastRewardClaimed(
  citySlug: string,
  payload: {
    rewardId: string
    rewardTitle: string
    redemptionCode: string
    codeExpiresAt: string
  },
): Promise<void> {
  await broadcastToRoom(`city:${citySlug}`, {
    type: 'reward:claimed',
    payload,
  })
}

/**
 * Broadcast reward slots update
 */
export async function broadcastRewardSlotsUpdate(
  citySlug: string,
  rewardId: string,
  slotsRemaining: number,
): Promise<void> {
  await broadcastToRoom(`city:${citySlug}`, {
    type: 'reward:slots_update',
    payload: {
      rewardId,
      slotsRemaining,
    },
  })
}

/**
 * Broadcast leaderboard update to a specific user
 */
export async function broadcastLeaderboardUpdate(userId: string, rank: number, delta: number): Promise<void> {
  await broadcastToUser(userId, {
    type: 'leaderboard:update',
    payload: {
      userId,
      rank,
      delta,
    },
  })
}

/**
 * Broadcast business check-in notification
 */
export async function broadcastBusinessCheckin(
  businessId: string,
  payload: {
    nodeId: string
    nodeName: string
    checkInCount: number
    avatarUrl?: string
    username?: string
  },
): Promise<void> {
  await broadcastToRoom(`business:${businessId}`, {
    type: 'business:checkin',
    payload,
  })
}

/**
 * Broadcast business reward claimed notification
 */
export async function broadcastBusinessRewardClaimed(
  businessId: string,
  payload: {
    nodeId: string
    nodeName: string
    rewardId: string
    rewardTitle: string
  },
): Promise<void> {
  await broadcastToRoom(`business:${businessId}`, {
    type: 'business:reward_claimed',
    payload,
  })
}

/**
 * Broadcast friend check-in notification
 */
export async function broadcastFriendCheckin(
  userId: string,
  payload: {
    message: string
    userId: string
    nodeId: string
    avatarUrl?: string
  },
): Promise<void> {
  await broadcastToUser(userId, {
    type: 'toast:friend_checkin',
    payload: {
      type: 'checkin',
      ...payload,
    },
  })
}

/**
 * Broadcast friend checkout notification. Emitted when a mutual friend checks
 * out (manual) or their presence expires so the client can remove them from the
 * friends-at-venue store (honest presence — Requirement 3.5).
 */
export async function broadcastFriendCheckout(
  recipientUserId: string,
  payload: { userId: string; nodeId: string },
): Promise<void> {
  await broadcastToUser(recipientUserId, {
    type: 'friend:checkout',
    payload,
  })
}
