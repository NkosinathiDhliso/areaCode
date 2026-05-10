/**
 * Business Billing Routes — GET /v1/business/me/billing
 * Paginated (20 per page), sorted by date descending, with ownership verification.
 *
 * Requirements: 9.2, 9.3, 22.3
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { z } from 'zod'
import { queryBusinessPayments } from '../admin/revenue-repository.js'

const billingQuerySchema = z.object({
  cursor: z.string().optional(),
})

const PAGE_SIZE = 20

export async function registerBillingRoutes(app: FastifyInstance) {
  // GET /v1/business/me/billing — paginated billing history
  app.get(
    '/v1/business/me/billing',
    { preHandler: [requireAuth('business'), validate({ query: billingQuerySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof billingQuerySchema>

      // Decode cursor if provided
      let exclusiveStartKey: Record<string, unknown> | undefined
      if (query.cursor) {
        try {
          exclusiveStartKey = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf-8'))
        } catch {
          // Invalid cursor, start from beginning
        }
      }

      // Query uses pk=PAYMENT#<businessId> — ownership is inherent in the partition key
      const { items, lastEvaluatedKey } = await queryBusinessPayments(
        auth.userId,
        PAGE_SIZE,
        exclusiveStartKey,
      )

      // Encode next cursor
      let nextCursor: string | null = null
      if (lastEvaluatedKey) {
        nextCursor = Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url')
      }

      return {
        items: items.map((item) => ({
          paymentId: item.paymentId,
          date: item.createdAt,
          description: item.description,
          amount: item.amount,
          status: item.status,
          type: item.type,
          planTier: item.planTier,
        })),
        nextCursor,
        hasMore: nextCursor !== null,
      }
    },
  )
}
