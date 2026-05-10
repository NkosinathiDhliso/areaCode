/**
 * Admin Revenue Routes — GET /v1/admin/revenue and GET /v1/admin/revenue/breakdown
 * with date range filters (today, this week, this month, custom).
 *
 * Requirements: 2.6, 2.7
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { z } from 'zod'
import * as revenueService from './revenue-service.js'
import { getAdminRole } from './admin-core-routes.js'
import { checkPermission } from './permissions.js'

const revenueQuerySchema = z.object({
  range: z.enum(['today', 'this_week', 'this_month', 'custom']).default('this_month'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

/**
 * Compute start/end ISO timestamps for a given range filter (SAST timezone).
 */
function getDateRange(range: string, startDate?: string, endDate?: string): { start: string; end: string } {
  const now = new Date()
  const sastOffset = 2 * 60 * 60 * 1000
  const sastNow = new Date(now.getTime() + sastOffset)

  if (range === 'custom' && startDate && endDate) {
    return { start: startDate, end: endDate }
  }

  const year = sastNow.getUTCFullYear()
  const month = sastNow.getUTCMonth()
  const day = sastNow.getUTCDate()
  const dayOfWeek = sastNow.getUTCDay()

  switch (range) {
    case 'today': {
      const startOfDay = new Date(Date.UTC(year, month, day) - sastOffset)
      return { start: startOfDay.toISOString(), end: now.toISOString() }
    }
    case 'this_week': {
      const startOfWeek = new Date(Date.UTC(year, month, day - dayOfWeek + 1) - sastOffset)
      return { start: startOfWeek.toISOString(), end: now.toISOString() }
    }
    case 'this_month':
    default: {
      const startOfMonth = new Date(Date.UTC(year, month, 1) - sastOffset)
      return { start: startOfMonth.toISOString(), end: now.toISOString() }
    }
  }
}

export async function registerRevenueRoutes(app: FastifyInstance) {
  const adminAuth = requireAuth('admin')

  // GET /v1/admin/revenue — revenue metrics with date range
  app.get(
    '/v1/admin/revenue',
    { preHandler: [adminAuth, validate({ query: revenueQuerySchema })] },
    async (request) => {
      const role = await getAdminRole(request)
      checkPermission(role, 'view_dashboard')

      const query = request.query as z.infer<typeof revenueQuerySchema>
      const { start, end } = getDateRange(query.range, query.startDate, query.endDate)

      const [mrr, boostRevenue, subscriptionCounts, trialConversionRate, flexDailyRevenue] =
        await Promise.all([
          revenueService.getMRR(),
          revenueService.getBoostRevenue(start, end),
          revenueService.getSubscriptionCounts(),
          revenueService.getTrialConversionRate(),
          revenueService.getFlexDailyRevenue(start, end),
        ])

      return {
        mrr,
        boostRevenue,
        subscriptionCounts,
        trialConversionRate,
        flexDailyRevenue,
        dateRange: { start, end, filter: query.range },
      }
    },
  )

  // GET /v1/admin/revenue/breakdown — per-business revenue breakdown
  app.get(
    '/v1/admin/revenue/breakdown',
    { preHandler: [adminAuth, validate({ query: revenueQuerySchema })] },
    async (request) => {
      const role = await getAdminRole(request)
      checkPermission(role, 'view_dashboard')

      const query = request.query as z.infer<typeof revenueQuerySchema>
      const { start, end } = getDateRange(query.range, query.startDate, query.endDate)

      const breakdown = await revenueService.getPerBusinessBreakdown(start, end)
      return { items: breakdown, dateRange: { start, end, filter: query.range } }
    },
  )
}
