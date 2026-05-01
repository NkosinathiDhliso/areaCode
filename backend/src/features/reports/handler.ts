import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { reportListQuerySchema, reportIdParamsSchema } from './types.js'
import { listReports, getReport } from './repository.js'
import { filterByTier } from './tier-gating.js'
import { findBusinessById } from '../business/repository.js'
import { AppError } from '../../shared/errors/AppError.js'
import type { z } from 'zod'

export async function reportRoutes(app: FastifyInstance) {
  // GET /v1/business/me/reports — paginated list of report summaries
  app.get(
    '/v1/business/me/reports',
    {
      preHandler: [
        requireAuth('business'),
        validate({ query: reportListQuerySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof reportListQuerySchema>
      const { items, nextCursor } = await listReports(
        auth.userId,
        query.cursor,
        query.period,
      )
      return { items, nextCursor }
    },
  )

  // GET /v1/business/me/reports/:reportId — full report content
  app.get(
    '/v1/business/me/reports/:reportId',
    {
      preHandler: [
        requireAuth('business'),
        validate({ params: reportIdParamsSchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof reportIdParamsSchema>

      const report = await getReport(auth.userId, params.reportId)
      if (!report) {
        throw AppError.notFound('Report not found')
      }

      const business = await findBusinessById(auth.userId)
      const tier = business?.tier ?? 'free'

      return filterByTier(report, tier)
    },
  )
}
