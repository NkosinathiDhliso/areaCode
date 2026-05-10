/**
 * WebSocket Health Service — queries the ws-connections DynamoDB table
 * to return active connection count, connections by room type, and uptime.
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { logger } from '../../shared/monitoring/logger.js'

const ddbClient = new DynamoDBClient({ region: process.env['AWS_REGION'] || 'us-east-1' })
const CONNECTIONS_TABLE = process.env['CONNECTIONS_TABLE'] || 'area-code-prod-websocket-connections'

const healthLogger = logger.child({ service: 'websocket-health' })

// Track when the service started for uptime calculation
const SERVICE_START_TIME = new Date()

export interface WebSocketHealthMetrics {
  activeConnections: number
  connectionsByRoom: Record<string, number>
  uptimeSeconds: number
}

/**
 * Get WebSocket health metrics: active connection count, connections by room type, and uptime.
 * Note: Scan is acceptable here because the ws-connections table only holds
 * ephemeral active connections (typically < 1000 items).
 */
export async function getWebSocketHealth(): Promise<WebSocketHealthMetrics> {
  let activeConnections = 0
  const connectionsByRoom: Record<string, number> = {}

  try {
    const result = await ddbClient.send(
      new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        ProjectionExpression: 'connectionId, roomId',
      }),
    )

    const items = result.Items?.map((item) => unmarshall(item)) || []
    activeConnections = items.length

    for (const item of items) {
      const roomId = (item.roomId as string) || 'unassigned'
      connectionsByRoom[roomId] = (connectionsByRoom[roomId] || 0) + 1
    }
  } catch (err) {
    healthLogger.error('Failed to query WebSocket connections table', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const uptimeSeconds = Math.floor((Date.now() - SERVICE_START_TIME.getTime()) / 1000)

  return {
    activeConnections,
    connectionsByRoom,
    uptimeSeconds,
  }
}
