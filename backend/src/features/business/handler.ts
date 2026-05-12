import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { requireBusinessPermission } from '../../shared/middleware/business-role.js'
import { validate } from '../../shared/middleware/validation.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import * as service from './service.js'
import {
  checkoutBodySchema,
  trialStartBodySchema,
  boostBodySchema,
  staffInviteBodySchema,
  staffIdParamsSchema,
} from './types.js'
import { z } from 'zod'
import { getRedemptionsByStaffId } from '../rewards/repository.js'

const nodeIdParamsSchema = z.object({ nodeId: z.string().uuid() })
const staffRedemptionParamsSchema = z.object({ staffId: z.string().uuid() })
const checkInQuerySchema = z.object({
  date: z.string().optional(),
  cursor: z.string().optional(),
})

export async function businessRoutes(app: FastifyInstance) {
  // GET /v1/business/me
  app.get('/v1/business/me', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getBusinessProfile(auth.cognitoSub)
  })

  // GET /v1/business/me/onboarding-status
  app.get('/v1/business/me/onboarding-status', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getOnboardingStatus(auth.userId)
  })

  // GET /v1/business/me/role — returns the current user's role and permissions
  app.get('/v1/business/me/role', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    const { getBusinessById } = await import('../auth/dynamodb-repository.js')
    const { getStaffById } = await import('../auth/dynamodb-repository.js')
    const { ROLE_PERMISSIONS } = await import('./types.js')
    type BusinessMemberRole = import('./types.js').BusinessMemberRole

    let role: BusinessMemberRole = 'owner'
    const business = await getBusinessById(auth.userId)
    if (!business) {
      const staff = await getStaffById(auth.userId)
      if (staff && staff.role === 'manager') {
        role = 'manager'
      } else {
        role = 'staff'
      }
    }

    return { role, permissions: ROLE_PERMISSIONS[role] }
  })

  // GET /v1/business/me/live-stats
  app.get('/v1/business/me/live-stats', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getLiveStats(auth.userId)
  })

  // GET /v1/business/me/nodes
  app.get('/v1/business/me/nodes', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getBusinessNodes(auth.userId)
  })

  // GET /v1/business/me/audience
  app.get('/v1/business/me/audience', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getAudienceAnalytics(auth.userId)
  })

  // GET /v1/business/me/recent-redemptions
  app.get('/v1/business/me/recent-redemptions', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getRecentRedemptions(auth.userId)
  })

  // GET /v1/business/rewards
  app.get('/v1/business/rewards', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getBusinessRewards(auth.userId)
  })

  // GET /v1/business/nodes/current/qr
  app.get('/v1/business/nodes/current/qr', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getCurrentNodeQr(auth.userId)
  })

  // GET /v1/business/plans
  app.get('/v1/business/plans', async () => {
    return service.getPlans()
  })

  // POST /v1/business/checkout
  app.post(
    '/v1/business/checkout',
    {
      preHandler: [requireAuth('business'), requireBusinessPermission('manage_billing'), validate({ body: checkoutBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof checkoutBodySchema>
      return service.createCheckoutSession(auth.userId, body.plan, body.interval)
    },
  )

  // POST /v1/business/trial/start
  // Activates a 14-day free trial on the Growth or Pro plan. One trial per
  // business, ever. Paying starts after the trial ends (Yoco checkout from
  // the Plans panel reminder, or via the same /v1/business/checkout route).
  app.post(
    '/v1/business/trial/start',
    {
      preHandler: [
        requireAuth('business'),
        requireBusinessPermission('manage_billing'),
        rateLimitMiddleware({ key: 'trial-start', max: 5, windowSeconds: 300 }),
        validate({ body: trialStartBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof trialStartBodySchema>
      return service.startTrial(auth.userId, body.plan)
    },
  )

  // POST /v1/business/boost
  app.post(
    '/v1/business/boost',
    {
      preHandler: [requireAuth('business'), validate({ body: boostBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof boostBodySchema>
      return service.purchaseBoost(auth.userId, body.nodeId, body.duration)
    },
  )

  // POST /v1/webhooks/yoco
  app.post(
    '/v1/webhooks/yoco',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'yoco-webhook', max: 100, windowSeconds: 60, identifierFn: () => 'yoco' }),
      ],
    },
    async (request, reply) => {
      const signature = (request.headers['x-yoco-signature'] as string) ?? ''
      const body = request.body as Record<string, unknown>
      const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(body)
      const eventId = (body['id'] as string) ?? ''
      const eventType = (body['type'] as string) ?? ''

      const result = await service.processYocoWebhook(eventId, eventType, body, signature, rawBody)
      return reply.status(200).send({ ok: true, duplicate: result.duplicate })
    },
  )

  // POST /v1/business/staff/invite
  app.post(
    '/v1/business/staff/invite',
    {
      preHandler: [requireAuth('business'), requireBusinessPermission('manage_staff'), validate({ body: staffInviteBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as { phone?: string; email?: string; role?: 'manager' | 'staff' }
      const inviteRole = body.role ?? 'staff'
      // Only owners can invite managers
      if (inviteRole === 'manager') {
        const { getBusinessRole } = await import('../../shared/middleware/business-role.js')
        const bizRole = getBusinessRole(request)
        if (bizRole.memberRole !== 'owner') {
          throw (await import('../../shared/errors/AppError.js')).AppError.forbidden('Only the owner can invite managers.')
        }
      }
      return service.inviteStaff(auth.userId, body.phone, body.email, inviteRole)
    },
  )

  // GET /v1/business/staff
  app.get('/v1/business/staff', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.listStaff(auth.userId)
  })

  // GET /v1/business/staff/invites
  app.get('/v1/business/staff/invites', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    const invites = await service.listStaffInvites(auth.userId)
    return { items: invites }
  })

  // DELETE /v1/business/staff/:id
  app.delete(
    '/v1/business/staff/:id',
    {
      preHandler: [requireAuth('business'), validate({ params: staffIdParamsSchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof staffIdParamsSchema>
      await service.removeStaff(params.id, auth.userId)
      return reply.status(204).send()
    },
  )

  // GET /v1/business/nodes/:nodeId/qr
  app.get(
    '/v1/business/nodes/:nodeId/qr',
    {
      preHandler: [requireAuth('business'), validate({ params: nodeIdParamsSchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      return service.getQrData(params.nodeId, auth.userId)
    },
  )

  // GET /v1/business/staff/:staffId/redemptions
  app.get(
    '/v1/business/staff/:staffId/redemptions',
    {
      preHandler: [requireAuth('business'), validate({ params: staffRedemptionParamsSchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof staffRedemptionParamsSchema>
      const items = await getRedemptionsByStaffId(params.staffId, auth.userId)
      return { items }
    },
  )

  // GET /v1/business/check-ins
  app.get(
    '/v1/business/check-ins',
    {
      preHandler: [requireAuth('business'), validate({ query: checkInQuerySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof checkInQuerySchema>
      return service.getCheckInDetails(auth.userId, query.date, query.cursor)
    },
  )

  // GET /v1/business/rewards/:rewardId/metrics
  app.get(
    '/v1/business/rewards/:rewardId/metrics',
    {
      preHandler: [requireAuth('business'), validate({ params: z.object({ rewardId: z.string().uuid() }) })],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as { rewardId: string }
      return service.getRewardMetrics(params.rewardId, auth.userId)
    },
  )

  // GET /v1/business/rewards/summary
  app.get('/v1/business/rewards/summary', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getRewardsSummary(auth.userId)
  })

  // POST /v1/business/downgrade
  app.post(
    '/v1/business/downgrade',
    { preHandler: [requireAuth('business'), requireBusinessPermission('manage_billing')] },
    async (request) => {
      const auth = getAuth(request)
      return service.downgradeToFree(auth.userId)
    },
  )
}
