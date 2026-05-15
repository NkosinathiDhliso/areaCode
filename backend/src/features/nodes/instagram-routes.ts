import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { AppError } from '../../shared/errors/AppError.js'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'

const instagramBodySchema = z.object({
  handle: z
    .string()
    .regex(/^[a-zA-Z0-9_.]{1,30}$/, 'Invalid Instagram handle')
    .nullable(),
})

const nodeIdParamsSchema = z.object({
  nodeId: z.string().min(1),
})

/**
 * Validates an Instagram handle.
 * Accepts alphanumeric + underscores + periods, max 30 chars.
 * Strips leading @ if present.
 */
export { validateInstagramHandle } from './instagram-validation.js'

export async function instagramRoutes(app: FastifyInstance) {
  /**
   * PUT /v1/business/nodes/:nodeId/instagram
   * Stores the Instagram handle (without @ prefix) on the node record.
   */
  app.put(
    '/v1/business/nodes/:nodeId/instagram',
    {
      preHandler: [requireAuth('business'), validate({ params: nodeIdParamsSchema, body: instagramBodySchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const { nodeId } = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof instagramBodySchema>

      // Verify node ownership
      const nodeResult = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
      const node = nodeResult.Item
      if (!node || node['businessId'] !== auth.userId) {
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
    },
  )
}
