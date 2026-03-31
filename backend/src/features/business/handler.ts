import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  checkoutBodySchema,
  boostBodySchema,
  staffInviteBodySchema,
  staffIdParamsSchema,
} from './types.js'
import { z } from 'zod'

const nodeIdParamsSchema = z.object({ nodeId: z.string().uuid() })

export async function businessRoutes(app: FastifyInstance) {
  // GET /v1/business/me
  app.get(
    '/v1/business/me',
    { preHandler: [requireAuth('business')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getBusinessProfile(auth.cognitoSub)
    },
  )

  // GET /v1/business/plans
  app.get('/v1/business/plans', async () => {
    return service.getPlans()
  })

  // POST /v1/business/checkout
  app.post(
    '/v1/business/checkout',
    {
      preHandler: [
        requireAuth('business'),
        validate({ body: checkoutBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof checkoutBodySchema>
      return service.createCheckoutSession(
        auth.userId,
        body.plan,
        body.interval,
      )
    },
  )

  // POST /v1/business/boost
  app.post(
    '/v1/business/boost',
    {
      preHandler: [
        requireAuth('business'),
        validate({ body: boostBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof boostBodySchema>
      return service.purchaseBoost(auth.userId, body.nodeId, body.duration)
    },
  )

  // POST /v1/webhooks/yoco
  app.post('/v1/webhooks/yoco', async (request, reply) => {
    const signature = request.headers['x-yoco-signature'] as string ?? ''
    const body = request.body as Record<string, unknown>
    const eventId = body['id'] as string ?? ''
    const eventType = body['type'] as string ?? ''

    const result = await service.processYocoWebhook(
      eventId,
      eventType,
      body,
      signature,
    )
    return reply.status(200).send({ ok: true, duplicate: result.duplicate })
  })

  // POST /v1/business/staff/invite
  app.post(
    '/v1/business/staff/invite',
    {
      preHandler: [
        requireAuth('business'),
        validate({ body: staffInviteBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as { phone?: string; email?: string }
      return service.inviteStaff(auth.userId, body.phone, body.email)
    },
  )

  // GET /v1/business/staff
  app.get(
    '/v1/business/staff',
    { preHandler: [requireAuth('business')] },
    async (request) => {
      const auth = getAuth(request)
      return service.listStaff(auth.userId)
    },
  )

  // DELETE /v1/business/staff/:id
  app.delete(
    '/v1/business/staff/:id',
    {
      preHandler: [
        requireAuth('business'),
        validate({ params: staffIdParamsSchema }),
      ],
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
      preHandler: [
        requireAuth('business'),
        validate({ params: nodeIdParamsSchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      return service.getQrData(params.nodeId, auth.userId)
    },
  )
}
