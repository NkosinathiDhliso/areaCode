import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../../shared/errors/AppError'
import { generateUploadUrl, deleteImage } from './image-service'
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb'

const uploadUrlSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png']),
})

export async function nodeImageRoutes(app: FastifyInstance) {
  /**
   * POST /v1/business/nodes/:nodeId/image/upload-url
   * Generates a presigned S3 PUT URL scoped to the nodeId.
   * JPEG/PNG only, max 2MB.
   */
  app.post('/v1/business/nodes/:nodeId/image/upload-url', async (request, reply) => {
    const business = (request as { business?: { id: string } }).business
    if (!business) {
      throw new AppError(401, 'unauthorized', 'Authentication required')
    }

    const { nodeId } = request.params as { nodeId: string }
    const body = uploadUrlSchema.parse(request.body)

    // Verify node ownership
    const nodeResult = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': `NODE#${nodeId}`,
          ':sk': 'METADATA',
        },
      }),
    )
    const node = nodeResult.Items?.[0]
    if (!node || node['businessId'] !== business.id) {
      throw new AppError(403, 'forbidden', 'You do not own this node')
    }

    // If node already has a header image, we'll replace it after upload
    const existingKey = node['headerImageKey'] as string | null

    const { uploadUrl, objectKey } = await generateUploadUrl(nodeId, body.contentType)

    // Store the pending key on the node (will be processed after upload)
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: `NODE#${nodeId}`, sk: 'METADATA' },
        UpdateExpression: 'SET headerImageKey = :key',
        ExpressionAttributeValues: { ':key': objectKey },
      }),
    )

    // Delete old image if replacing
    if (existingKey && existingKey !== objectKey) {
      try { await deleteImage(existingKey) } catch { /* best effort */ }
    }

    return reply.send({ uploadUrl, objectKey })
  })

  /**
   * DELETE /v1/business/nodes/:nodeId/image
   * Deletes the header image for a node.
   */
  app.delete('/v1/business/nodes/:nodeId/image', async (request, reply) => {
    const business = (request as { business?: { id: string } }).business
    if (!business) {
      throw new AppError(401, 'unauthorized', 'Authentication required')
    }

    const { nodeId } = request.params as { nodeId: string }

    // Verify node ownership
    const nodeResult = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': `NODE#${nodeId}`,
          ':sk': 'METADATA',
        },
      }),
    )
    const node = nodeResult.Items?.[0]
    if (!node || node['businessId'] !== business.id) {
      throw new AppError(403, 'forbidden', 'You do not own this node')
    }

    const headerImageKey = node['headerImageKey'] as string | null
    if (headerImageKey) {
      await deleteImage(headerImageKey)
      await documentClient.send(
        new UpdateCommand({
          TableName: TableNames.appData,
          Key: { pk: `NODE#${nodeId}`, sk: 'METADATA' },
          UpdateExpression: 'REMOVE headerImageKey',
        }),
      )
    }

    return reply.send({ success: true })
  })
}
