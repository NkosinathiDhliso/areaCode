// WebSocket Broadcast Helper for Backend Lambdas
// Allows any Lambda function to broadcast real-time events to connected clients

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, QueryCommand as DocQueryCommand } from '@aws-sdk/lib-dynamodb'

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

// At most this many PostToConnection calls are in flight at once, so a large
// room does not stampede the API Gateway management API's per-account limit.
const FANOUT_CONCURRENCY = 25

/** Outcome of a single PostToConnection attempt, classified without throwing. */
type PostStatus = 'posted' | 'gone' | 'failed'

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

/**
 * Post one message to one connection and classify the outcome as
 * {posted, gone, failed} without throwing. `GoneException` (a stale connection
 * the TTL will clean up) maps to `gone`; any other error maps to `failed` and
 * carries the original error so single-connection callers can rethrow it. This
 * is the one classification the fan-out counts and `sendToConnection` reuses.
 */
async function postToConnection(
  client: ApiGatewayManagementApiClient,
  connectionId: string,
  message: BroadcastMessage,
): Promise<{ status: PostStatus; error?: unknown }> {
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message),
      }),
    )
    return { status: 'posted' }
  } catch (error: any) {
    if (error?.name === 'GoneException') {
      return { status: 'gone' }
    }
    return { status: 'failed', error }
  }
}

/**
 * Send a message to a single connection. Stale (`GoneException`) connections are
 * ignored and logged; any other failure is rethrown to the caller. This is the
 * single-connection helper used by the websocket route handlers (room join/leave
 * acknowledgements); its throw-on-failure contract is unchanged.
 */
export async function sendToConnection(connectionId: string, message: BroadcastMessage): Promise<void> {
  const client = await getApiClient()
  const { status, error } = await postToConnection(client, connectionId, message)

  if (status === 'gone') {
    // Connection is stale - ignore, it'll be cleaned up by TTL
    console.log(`Connection ${connectionId} is gone`)
  } else if (status === 'failed') {
    throw error
  }
}

/**
 * Fan a message out to many connections with bounded concurrency. Runs a pool
 * of at most `FANOUT_CONCURRENCY` in-flight `PostToConnection` calls, collecting
 * each outcome with `allSettled` semantics so one bad socket neither rejects the
 * batch nor stampedes the API Gateway limit. Stale (`gone`) connections are
 * ignored (TTL cleans them up) and non-Gone failures are counted, never thrown
 * to the caller. Emits one summary log per broadcast and returns ONLY the
 * successful-post count, which callers use to decide push fallback.
 */
async function fanOut(connections: ConnectionRow[], message: BroadcastMessage, label: string): Promise<number> {
  const client = await getApiClient()
  let posted = 0
  let gone = 0
  let failed = 0

  // Shared cursor over the connections; each worker claims the next index
  // atomically (index++ is synchronous, so no two workers claim the same row).
  let next = 0
  async function worker(): Promise<void> {
    while (next < connections.length) {
      const conn = connections[next++]!
      const { status } = await postToConnection(client, conn.connectionId, message)
      if (status === 'posted') posted++
      else if (status === 'gone') gone++
      else failed++
    }
  }

  const workerCount = Math.min(FANOUT_CONCURRENCY, connections.length)
  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()))

  console.log(`posted=${posted} gone=${gone} failed=${failed} ${label}`)
  return posted
}

// ============================================================================
// BROADCAST FUNCTIONS
// ============================================================================

interface ConnectionRow {
  connectionId: string
  [key: string]: unknown
}

/**
 * Query every connection row matching an index/key expression, paginating over
 * `LastEvaluatedKey` so no rows past the first query page are missed. Uses
 * `documentClient` (no manual marshall/unmarshall) for consistency with
 * `deleteConnectionsByUser`, returning rows whose `connectionId` the fan-out
 * uses directly.
 */
async function queryAllConnections(
  indexName: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, unknown>,
): Promise<ConnectionRow[]> {
  const connections: ConnectionRow[] = []
  let cursor: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new DocQueryCommand({
        TableName: CONNECTIONS_TABLE,
        IndexName: indexName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )

    for (const item of result.Items || []) {
      connections.push(item as ConnectionRow)
    }

    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)

  return connections
}

// Push-only Lambdas (streak-reminder, pulse-decay style) deliberately get no
// WEBSOCKET_ENDPOINT and no connections-table/execute-api IAM; their Terraform
// blocks document "falls back to push, by design". Skipping BEFORE the
// connections Query keeps that designed no-op from surfacing as an
// AccessDeniedException error log (2026-07-10 go-live FAIL). Logged once per
// container at info level; Lambdas that DO hold an endpoint still fail loudly.
let loggedNoEndpoint = false
function socketDeliveryUnavailable(label: string): boolean {
  if (WEBSOCKET_ENDPOINT) return false
  if (!loggedNoEndpoint) {
    loggedNoEndpoint = true
    console.log(`[broadcast] no WEBSOCKET_ENDPOINT; socket delivery skipped, push fallback owns delivery (${label})`)
  }
  return true
}

/**
 * Broadcast a message to all connections in a room (e.g., city:capetown).
 * Returns the number of connections that were posted to successfully (stale and
 * failed sockets are excluded), which callers use to decide push fallback.
 * On a push-only Lambda (no WEBSOCKET_ENDPOINT) this is a designed no-op that
 * returns 0 so callers go straight to push.
 */
export async function broadcastToRoom(roomId: string, message: BroadcastMessage): Promise<number> {
  if (socketDeliveryUnavailable(`room=${roomId}`)) return 0
  const connections = await queryAllConnections('RoomIndex', 'roomId = :roomId', { ':roomId': roomId })

  return fanOut(connections, message, `room=${roomId}`)
}

/**
 * Broadcast a message to all connections for a specific user.
 * Returns the count of connections posted to successfully (stale and failed
 * sockets excluded), so callers can fall back to push delivery when the user has
 * no live socket that received the message.
 * On a push-only Lambda (no WEBSOCKET_ENDPOINT) this is a designed no-op that
 * returns 0 so callers go straight to push.
 */
export async function broadcastToUser(userId: string, message: BroadcastMessage): Promise<number> {
  if (socketDeliveryUnavailable(`user=${userId}`)) return 0
  const connections = await queryAllConnections('UserIndex', 'userId = :userId', { ':userId': userId })

  return fanOut(connections, message, `user=${userId}`)
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
