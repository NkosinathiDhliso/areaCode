// WebSocket Lambda Handler for API Gateway
// Manages connections, rooms, and broadcasts events

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

const ddbClient = new DynamoDBClient({ region: process.env['AWS_REGION'] || 'us-east-1' })

// Connection management table
const CONNECTIONS_TABLE = process.env['CONNECTIONS_TABLE'] || 'area-code-prod-websocket-connections'

// WebSocket API endpoint (for sending messages back)
const WEBSOCKET_ENDPOINT = process.env['WEBSOCKET_ENDPOINT']

interface WebSocketEvent {
  requestContext: {
    connectionId: string
    routeKey: string
    apiId: string
    stage: string
    domainName: string
  }
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

export async function handler(event: WebSocketEvent, context: WebSocketContext): Promise<any> {
  const { routeKey, connectionId } = event.requestContext

  console.log(`WebSocket ${routeKey}: ${connectionId}`)

  try {
    switch (routeKey) {
      case '$connect':
        return await handleConnect(connectionId, event)
      case '$disconnect':
        return await handleDisconnect(connectionId)
      case 'room:join':
        return await handleJoinRoom(connectionId, event)
      case 'room:leave':
        return await handleLeaveRoom(connectionId, event)
      case 'presence:join':
        return await handlePresenceJoin(connectionId, event)
      case 'presence:leave':
        return await handlePresenceLeave(connectionId, event)
      case '$default':
        return await handleDefault(connectionId, event)
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

async function handleConnect(connectionId: string, event: WebSocketEvent): Promise<any> {
  // Extract auth token from query string if present
  const queryString = event.requestContext?.stage
  // Store connection with TTL (1 day)
  const ttl = Math.floor(Date.now() / 1000) + 86400

  await ddbClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({
        connectionId,
        connectedAt: new Date().toISOString(),
        ttl,
      }),
    })
  )

  return { statusCode: 200, body: 'Connected' }
}

async function handleDisconnect(connectionId: string): Promise<any> {
  await ddbClient.send(
    new DeleteItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: marshall({ connectionId }),
    })
  )

  return { statusCode: 200, body: 'Disconnected' }
}

// ============================================================================
// ROOM MANAGEMENT
// ============================================================================

async function handleJoinRoom(connectionId: string, event: WebSocketEvent): Promise<any> {
  if (!event.body) return { statusCode: 400, body: 'Missing body' }

  const data = JSON.parse(event.body)
  const { room, userId, citySlug } = data.payload || {}

  if (!room) return { statusCode: 400, body: 'Missing room' }

  // Update connection record with room info
  const ttl = Math.floor(Date.now() / 1000) + 86400

  await ddbClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({
        connectionId,
        roomId: room,
        userId: userId || null,
        citySlug: citySlug || null,
        joinedAt: new Date().toISOString(),
        ttl,
      }),
    })
  )

  // Acknowledge
  await sendToConnection(connectionId, {
    type: 'room:joined',
    payload: { room },
  })

  return { statusCode: 200, body: 'Joined room' }
}

async function handleLeaveRoom(connectionId: string, event: WebSocketEvent): Promise<any> {
  if (!event.body) return { statusCode: 400, body: 'Missing body' }

  const data = JSON.parse(event.body)
  const { room } = data.payload || {}

  // Remove room from connection
  await ddbClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({
        connectionId,
        roomId: null,
        leftAt: new Date().toISOString(),
      }),
    })
  )

  await sendToConnection(connectionId, {
    type: 'room:left',
    payload: { room },
  })

  return { statusCode: 200, body: 'Left room' }
}

// ============================================================================
// PRESENCE MANAGEMENT
// ============================================================================

async function handlePresenceJoin(connectionId: string, event: WebSocketEvent): Promise<any> {
  if (!event.body) return { statusCode: 400, body: 'Missing body' }

  const data = JSON.parse(event.body)
  const { nodeId } = data.payload || {}

  // Update connection with presence info
  await ddbClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({
        connectionId,
        nodeId,
        presenceAt: new Date().toISOString(),
      }),
    })
  )

  return { statusCode: 200, body: 'Presence joined' }
}

async function handlePresenceLeave(connectionId: string, event: WebSocketEvent): Promise<any> {
  await ddbClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({
        connectionId,
        nodeId: null,
        presenceLeftAt: new Date().toISOString(),
      }),
    })
  )

  return { statusCode: 200, body: 'Presence left' }
}

// ============================================================================
// DEFAULT HANDLER
// ============================================================================

async function handleDefault(connectionId: string, event: WebSocketEvent): Promise<any> {
  console.log('Default route:', event.body)
  return { statusCode: 200, body: 'OK' }
}

// ============================================================================
// BROADCAST HELPERS (called by other lambdas)
// ============================================================================

interface BroadcastMessage {
  type: string
  payload: Record<string, unknown>
}

async function sendToConnection(connectionId: string, message: BroadcastMessage): Promise<void> {
  const endpoint = WEBSOCKET_ENDPOINT || process.env['WEBSOCKET_API_ENDPOINT']
  if (!endpoint) {
    console.error('No WebSocket endpoint configured')
    return
  }

  const client = new ApiGatewayManagementApiClient({
    region: process.env['AWS_REGION'] || 'us-east-1',
    endpoint,
  })

  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message),
      })
    )
  } catch (error: any) {
    if (error.name === 'GoneException') {
      // Connection is dead, clean it up
      await ddbClient.send(
        new DeleteItemCommand({
          TableName: CONNECTIONS_TABLE,
          Key: marshall({ connectionId }),
        })
      )
    } else {
      throw error
    }
  }
}

// Export for use by other lambdas
export async function broadcastToRoom(roomId: string, message: BroadcastMessage): Promise<void> {
  // Query all connections in room
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'RoomIndex',
      KeyConditionExpression: 'roomId = :roomId',
      ExpressionAttributeValues: marshall({ ':roomId': roomId }),
    })
  )

  const connections = result.Items?.map((item) => unmarshall(item)) || []

  // Send to all connections in parallel
  await Promise.all(
    connections.map((conn) => sendToConnection(conn.connectionId, message))
  )

  console.log(`Broadcasted to ${connections.length} connections in room ${roomId}`)
}

export async function broadcastToUser(userId: string, message: BroadcastMessage): Promise<void> {
  // Query all connections for user
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: marshall({ ':userId': userId }),
    })
  )

  const connections = result.Items?.map((item) => unmarshall(item)) || []

  await Promise.all(
    connections.map((conn) => sendToConnection(conn.connectionId, message))
  )

  console.log(`Broadcasted to ${connections.length} connections for user ${userId}`)
}

export async function broadcastToAll(message: BroadcastMessage): Promise<void> {
  // Scan all connections (use sparingly for small user bases)
  const result = await ddbClient.send(
    new ScanCommand({
      TableName: CONNECTIONS_TABLE,
    })
  )

  const connections = result.Items?.map((item) => unmarshall(item)) || []

  await Promise.all(
    connections.map((conn) => sendToConnection(conn.connectionId, message))
  )

  console.log(`Broadcasted to ${connections.length} total connections`)
}
