import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../../shared/errors/AppError'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb'

const instagramSchema = z.object({
  handle: z
    .string()
    .regex(/^[a-zA-Z0-9_.]{1,30}$/, 'Invalid Instagram handle')
    .nullable(),
})

/**
 * Validates an Instagram handle.
 * Accepts alphanumeric + underscores + periods, max 30 chars.
 * Strips leading @ if present.
 */
export { validateInstagramHandle } from './instagram-validation'

export async function instagramRoutes(app: FastifyInstance) {
  /**
   * PUT /v1/business/nodes/:nodeId/instagram
   * Stores the Instagram handle (without @ prefix) on the node record.
   */
  app.put('/v1/business/nodes/:nodeId/instagram', async (request, reply) => {
    const business = (request as { business?: { id: string } }).business
    if (!business) {
      throw new AppError(401, 'unauthorized', 'Authentication required')
    }

    const { nodeId } = request.params as { nodeId: string }
    const body = instagramSchema.parse(request.body)

    // Verify node ownership
    const nodeResult = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
    const node = nodeResult.Item
    if (!node || node['businessId'] !== business.id) {
      throw new AppError(403, 'forbidden', 'You do not own this node')
    }

    // Store handle without @ prefix
    const handle = body.handle?.replace(/^@/, '') ?? null

    if (handle) {
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.nodes,
          Key: { nodeId },
          UpdateExpression: 'SET instagramHandle = :handle',
          ExpressionAttributeValues: { ':handle': handle },
        }),
      )
    } else {
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.nodes,
          Key: { nodeId },
          UpdateExpression: 'REMOVE instagramHandle',
        }),
      )
    }

    return reply.send({ success: true, handle })
  })
}
