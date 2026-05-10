import type { FastifyInstance } from 'fastify'
import { getBoostROI } from './boost-roi-service'
import { AppError } from '../../shared/errors/AppError'

export async function boostRoiRoutes(app: FastifyInstance) {
  app.get('/v1/business/me/boosts/roi', async (request, reply) => {
    const business = (request as { business?: { id: string } }).business
    if (!business) {
      throw new AppError(401, 'unauthorized', 'Authentication required')
    }

    const { nodeId } = request.query as { nodeId?: string }

    // Ownership verification: if nodeId provided, verify it belongs to this business
    if (nodeId) {
      const { QueryCommand } = await import('@aws-sdk/lib-dynamodb')
      const { documentClient, TableNames } = await import('../../shared/db/dynamodb')
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
    }

    const results = await getBoostROI(business.id, nodeId)
    return reply.send({ items: results })
  })
}
