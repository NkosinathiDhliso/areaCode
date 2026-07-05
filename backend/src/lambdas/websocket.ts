// WebSocket Lambda Handler for API Gateway
// Registers connections with verified identity and manages room membership.
//
// Contract with the frontend (packages/shared/lib/websocket.ts):
//   - The client connects with ?token=...&citySlug=... query params. Identity
//     (userId / businessId) is derived ONLY from the verified JWT; any
//     client-supplied identity params are ignored.
//   - The client's app-level `room:join` / `room:leave` events are mapped by
//     the client to the `joinroom` / `leaveroom` route keys, because API
//     Gateway route keys cannot contain colons.
//   - Fan-out (broadcastToRoom / broadcastToUser in
//     shared/websocket/broadcast.ts) reads the roomId / userId attributes this
//     handler writes. A connection that never lands here receives nothing.

import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

import { AWS_REGION, requireEnv } from '../shared/config/env.js'
import { verifyBearerToken, type AuthPayload } from '../shared/middleware/auth.js'
import { cityRoom, businessRoom, isRoomAllowed, VALID_CITY_SLUGS } from '../shared/socket/rooms.js'
import { sendToConnection } from '../shared/websocket/broadcast.js'

const ddbClient = new DynamoDBClient({ region: AWS_REGION })

// Connection management table
const CONNECTIONS_TABLE = requireEnv('CONNECTIONS_TABLE', 'area-code-dev-websocket-connections')

// API Gateway hard-caps any WebSocket connection at 2 hours; the generous TTL
// only exists so dead rows the $disconnect handler missed still expire.
const CONNECTION_TTL_SECONDS = 86400

interface WebSocketEvent {
  requestContext: {
    connectionId: string
    routeKey: string
    apiId: string
    stage: string
    domainName: string
  }
  queryStringParameters?: Record<string, string | undefined>
  body?: string
}

interface WebSocketContext {
  callbackWaitsForEmptyEventLoop: boolean
  functionName: string
  memoryLimitInMB: string
  invokedFunctionArn: string
  awsRequestId: string
}

// ============================================================================
// HANDLERS
// ============================================================================

export async function handler(event: WebSocketEvent, _context: WebSocketContext): Promise<unknown> {
  const { routeKey, connectionId } = event.requestContext

  console.log(`WebSocket ${routeKey}: ${connectionId}`)

  try {
    switch (routeKey) {
      case '$connect':
        return await handleConnect(connectionId, event)
      case '$disconnect':
        return await handleDisconnect(connectionId)
      case 'joinroom':
        return await handleJoinRoom(connectionId, event)
      case 'leaveroom':
        return await handleLeaveRoom(connectionId, event)
      case '$default':
        // Heartbeat pings and unknown actions land here; a 200 resets the
        // API Gateway idle timer, which is the point of the client's ping.
        return { statusCode: 200, body: 'OK' }
      default:
        return { statusCode: 400, body: 'Unknown route' }
    }
  } catch (error) {
    console.error(`Error handling ${routeKey}:`, error)
    return { statusCode: 500, body: 'Internal server error' }
  }
}

// ============================================================================
// CONNECT / DISCONNECT
// ============================================================================

async function handleConnect(connectionId: string, event: WebSocketEvent): Promise<unknown> {
  const params = event.queryStringParameters ?? {}
  const token = params['token']

  // Verify identity when a token is presented. Fail closed: a presented but
  // invalid token rejects the connection; the client reconnects with a fresh
  // token after its refresh cycle. No token connects anonymously (city rooms
  // only - the live map is public data).
  let identity: AuthPayload | null = null
  if (token) {
    try {
      identity = await verifyBearerToken(token, ['consumer', 'business', 'staff', 'admin'])
    } catch {
      return { statusCode: 401, body: 'Unauthorized' }
    }
  }

  const item: Record<string, unknown> = {
    connectionId,
    connectedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
  }

  // City room from the (validated) query param; consumers may also join or
  // switch later via joinroom.
  const citySlug = params['citySlug']
  if (citySlug && VALID_CITY_SLUGS.has(citySlug)) {
    item['roomId'] = cityRoom(citySlug)
  }

  if (identity) {
    if (identity.role === 'consumer') {
      // userId powers broadcastToUser (reward codes, friend toasts, tier
      // changes) via the UserIndex GSI.
      item['userId'] = identity.userId
    }
    if (identity.role === 'business') {
      // The operator IS the venue (userId === businessId). Auto-join their
      // own business room so live check-ins arrive without an extra hop.
      item['businessId'] = identity.userId
      item['roomId'] = businessRoom(identity.userId)
    }
    if (identity.role === 'staff' && identity.businessId) {
      item['businessId'] = identity.businessId
    }
  }

  await ddbClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall(item),
    }),
  )

  return { statusCode: 200, body: 'Connected' }
}

async function handleDisconnect(connectionId: string): Promise<unknown> {
  await ddbClient.send(
    new DeleteItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: marshall({ connectionId }),
    }),
  )

  return { statusCode: 200, body: 'Disconnected' }
}

// ============================================================================
// ROOM MANAGEMENT
// ============================================================================

async function handleJoinRoom(connectionId: string, event: WebSocketEvent): Promise<unknown> {
  if (!event.body) return { statusCode: 400, body: 'Missing body' }

  const data = JSON.parse(event.body) as { payload?: { room?: unknown } }
  const room = data.payload?.room

  if (!room || typeof room !== 'string') return { statusCode: 400, body: 'Missing room' }

  // Authorise against the identity verified at $connect - never against
  // anything in the message body.
  const existing = await ddbClient.send(
    new GetItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: marshall({ connectionId }),
    }),
  )
  const row = existing.Item ? unmarshall(existing.Item) : {}

  if (!isRoomAllowed(room, { businessId: row['businessId'] as string | undefined })) {
    return { statusCode: 403, body: 'Room not allowed' }
  }

  // Targeted update: never PutItem here, that would wipe the verified
  // identity attributes written at $connect.
  await ddbClient.send(
    new UpdateItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: marshall({ connectionId }),
      UpdateExpression: 'SET roomId = :room, joinedAt = :at, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: marshall({
        ':room': room,
        ':at': new Date().toISOString(),
        ':ttl': Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
      }),
    }),
  )

  await sendToConnection(connectionId, { type: 'room:joined', payload: { room } })

  return { statusCode: 200, body: 'Joined room' }
}

async function handleLeaveRoom(connectionId: string, event: WebSocketEvent): Promise<unknown> {
  let room: string | undefined
  if (event.body) {
    const data = JSON.parse(event.body) as { payload?: { room?: unknown } }
    if (typeof data.payload?.room === 'string') room = data.payload.room
  }

  await ddbClient.send(
    new UpdateItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: marshall({ connectionId }),
      UpdateExpression: 'REMOVE roomId SET leftAt = :at',
      ExpressionAttributeValues: marshall({ ':at': new Date().toISOString() }),
    }),
  )

  await sendToConnection(connectionId, { type: 'room:left', payload: { room: room ?? null } })

  return { statusCode: 200, body: 'Left room' }
}
