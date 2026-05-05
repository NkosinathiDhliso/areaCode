import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { reportListQuerySchema, reportIdParamsSchema } from './types.js'
import { listReports, getReport } from './repository.js'
import { filterByTier } from './tier-gating.js'
import { findBusinessById } from '../business/repository.js'
import { AppError } from '../../shared/errors/AppError.js'
import { generateReportNow } from './generator.js'

const generateReportBodySchema = z.object({
  periodType: z.enum(['weekly', 'monthly']),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
})

export async function reportRoutes(app: FastifyInstance) {
  // GET /v1/business/me/reports — paginated list of report summaries
  app.get(
    '/v1/business/me/reports',
    {
      preHandler: [requireAuth('business'), validate({ query: reportListQuerySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof reportListQuerySchema>
      const { items, nextCursor } = await listReports(auth.userId, query.cursor, query.period)
      return { items, nextCursor }
    },
  )

  // GET /v1/business/me/reports/:reportId — full report content
  app.get(
    '/v1/business/me/reports/:reportId',
    {
      preHandler: [requireAuth('business'), validate({ params: reportIdParamsSchema })],
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

  // POST /v1/business/me/reports/generate — generate a fresh report on demand.
  // Synchronous: runs the analyzer pipeline inline and returns the new reportId.
  app.post(
    '/v1/business/me/reports/generate',
    {
      preHandler: [requireAuth('business'), validate({ body: generateReportBodySchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof generateReportBodySchema>

      // Default period: trailing 7 days for weekly, trailing 30 days for monthly
      const now = new Date()
      const periodEnd = body.periodEnd ?? now.toISOString()
      const defaultStartMs =
        new Date(periodEnd).getTime() - (body.periodType === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000
      const periodStart = body.periodStart ?? new Date(defaultStartMs).toISOString()

      const result = await generateReportNow(auth.userId, body.periodType, periodStart, periodEnd)

      if ('skipped' in result) {
        return reply.status(202).send({
          generated: false,
          reason: result.skipped,
          message:
            result.skipped === 'no_nodes'
              ? 'You have no venues yet. Add a venue first.'
              : result.skipped === 'no_check_ins'
                ? 'No check-ins recorded in this period yet. Try again later or pick a longer period.'
                : 'Report could not be generated due to a data integrity check. Please contact support.',
        })
      }

      return { generated: true, reportId: result.reportId }
    },
  )
}
