import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { AppError } from '../../shared/errors/AppError.js'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'

import { generateUploadUrl, deleteImage } from './image-service.js'

const uploadUrlBodySchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png']),
})

const nodeIdParamsSchema = z.object({
  nodeId: z.string().min(1),
})

export async function nodeImageRoutes(app: FastifyInstance) {
  /**
   * POST /v1/business/nodes/:nodeId/image/upload-url
   * Generates a presigned S3 PUT URL scoped to the nodeId.
   * JPEG/PNG only, max 2MB.
   */
  app.post(
    '/v1/business/nodes/:nodeId/image/upload-url',
    {
      preHandler: [requireAuth('business'), validate({ params: nodeIdParamsSchema, body: uploadUrlBodySchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const { nodeId } = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof uploadUrlBodySchema>

      // Verify node ownership
      const nodeResult = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
      const node = nodeResult.Item
      if (!node || node['businessId'] !== auth.userId) {
        throw new AppError(403, 'forbidden', 'You do not own this node')
      }

      // If node already has a header image, we'll replace it after upload
      const existingKey = (node['headerImageKey'] as string | undefined) ?? null

      const { uploadUrl, objectKey } = await generateUploadUrl(nodeId, body.contentType)

      // Store the pending key on the node (will be processed after upload)
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.nodes,
          Key: { nodeId },
          UpdateExpression: 'SET headerImageKey = :key',
          ExpressionAttributeValues: { ':key': objectKey },
        }),
      )

      // Delete old image if replacing
      if (existingKey && existingKey !== objectKey) {
        try {
          await deleteImage(existingKey)
        } catch {
          /* best effort */
        }
      }

      return reply.send({ uploadUrl, objectKey })
    },
  )

  /**
   * DELETE /v1/business/nodes/:nodeId/image
   * Deletes the header image for a node.
   */
  app.delete(
    '/v1/business/nodes/:nodeId/image',
    {
      preHandler: [requireAuth('business'), validate({ params: nodeIdParamsSchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const { nodeId } = request.params as z.infer<typeof nodeIdParamsSchema>

      // Verify node ownership
      const nodeResult = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
      const node = nodeResult.Item
      if (!node || node['businessId'] !== auth.userId) {
        throw new AppError(403, 'forbidden', 'You do not own this node')
      }

      const headerImageKey = (node['headerImageKey'] as string | undefined) ?? null
      if (headerImageKey) {
        await deleteImage(headerImageKey)
        await documentClient.send(
          new UpdateCommand({
            TableName: TableNames.nodes,
            Key: { nodeId },
            UpdateExpression: 'REMOVE headerImageKey',
          }),
        )
      }

      return reply.send({ success: true })
    },
  )
}
