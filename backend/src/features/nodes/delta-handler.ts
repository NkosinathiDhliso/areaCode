import type { FastifyInstance } from 'fastify'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { z } from 'zod'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { validate } from '../../shared/middleware/validation.js'
import { AppError } from '../../shared/errors/AppError.js'
import { prisma } from '../../shared/db/prisma.js'

// ============================================================================
// Types
// ============================================================================

type NodeState = 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'

interface DeltaNode {
  nodeId: string
  pulseScore?: number
  state?: NodeState
  checkInCount?: number
  consensusGenre?: string | null
  consensusGenreConfidence?: number
  consensusQueue?: 'none' | 'short' | 'long' | null
  consensusQueueConfidence?: number
  signalReportCount?: number
  lastSignalAt?: string
  isOwnerReport?: boolean
}

interface DeltaResponse {
  nodes: DeltaNode[]
  serverTime: string // ISO 8601, client uses as next `since` value
}

// ============================================================================
// Validation Schemas
// ============================================================================

const deltaParamsSchema = z.object({
  slug: z.string().min(1),
})

const deltaQuerySchema = z.object({
  since: z.string().min(1, 'since parameter required'),
})

// ============================================================================
// Helpers
// ============================================================================

function isValidISOTimestamp(value: string): boolean {
  const date = new Date(value)
  return !isNaN(date.getTime()) && date.toISOString() === value
}

function mapNodeRecord(record: Record<string, unknown>): DeltaNode {
  const node: DeltaNode = {
    nodeId: record['nodeId'] as string,
  }

  if (record['pulseScore'] !== undefined) {
    node.pulseScore = record['pulseScore'] as number
  }
  if (record['state'] !== undefined) {
    node.state = record['state'] as NodeState
  }
  if (record['checkInCount'] !== undefined) {
    node.checkInCount = record['checkInCount'] as number
  }
  if (record['consensusGenre'] !== undefined) {
    node.consensusGenre = record['consensusGenre'] as string | null
  }
  if (record['consensusGenreConfidence'] !== undefined) {
    node.consensusGenreConfidence = record['consensusGenreConfidence'] as number
  }
  if (record['consensusQueue'] !== undefined) {
    node.consensusQueue = record['consensusQueue'] as 'none' | 'short' | 'long' | null
  }
  if (record['consensusQueueConfidence'] !== undefined) {
    node.consensusQueueConfidence = record['consensusQueueConfidence'] as number
  }
  if (record['signalReportCount'] !== undefined) {
    node.signalReportCount = record['signalReportCount'] as number
  }
  if (record['lastSignalAt'] !== undefined) {
    node.lastSignalAt = record['lastSignalAt'] as string
  }
  if (record['lastSignalIsOwner'] !== undefined) {
    node.isOwnerReport = record['lastSignalIsOwner'] as boolean
  }

  return node
}

// ============================================================================
// Route Registration
// ============================================================================

export async function deltaRoutes(app: FastifyInstance) {
  // GET /v1/pulse/city/:slug/delta?since=<ISO timestamp>
  app.get(
    '/v1/pulse/city/:slug/delta',
    {
      preHandler: [validate({ params: deltaParamsSchema, query: deltaQuerySchema })],
    },
    async (request, reply) => {
      const params = request.params as z.infer<typeof deltaParamsSchema>
      const query = request.query as z.infer<typeof deltaQuerySchema>

      // Validate since is a valid ISO timestamp
      if (!isValidISOTimestamp(query.since)) {
        throw new AppError(400, 'validation_error', 'Invalid ISO timestamp')
      }

      // Resolve city slug to city ID
      const city = await prisma.city.findUnique({
        where: { slug: params.slug },
        select: { id: true },
      })

      if (!city) {
        throw AppError.notFound('City not found')
      }

      // Query CityUpdatedIndex GSI for nodes updated since the given timestamp
      const result = await documentClient.send(
        new QueryCommand({
          TableName: TableNames.nodes,
          IndexName: 'CityUpdatedIndex',
          KeyConditionExpression: 'cityId = :city AND signalUpdatedAt > :since',
          ExpressionAttributeValues: {
            ':city': city.id,
            ':since': query.since,
          },
        }),
      )

      const nodes: DeltaNode[] = (result.Items ?? []).map((item) =>
        mapNodeRecord(item as Record<string, unknown>),
      )

      const response: DeltaResponse = {
        nodes,
        serverTime: new Date().toISOString(),
      }

      return reply.send(response)
    },
  )
}
