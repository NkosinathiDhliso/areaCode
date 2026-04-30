import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import * as service from './service.js'
import {
  updatePrivacyBodySchema,
  blockParamsSchema,
  createReportBodySchema,
} from './types.js'
import { z } from 'zod'

export async function privacyRoutes(app: FastifyInstance) {
  // ─── Privacy Settings ─────────────────────────────────────────────────

  // GET /v1/users/me/privacy — return current privacy settings
  app.get(
    '/v1/users/me/privacy',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getPrivacySettings(auth.userId)
    },
  )

  // PATCH /v1/users/me/privacy — update privacy level
  app.patch(
    '/v1/users/me/privacy',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ body: updatePrivacyBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof updatePrivacyBodySchema>
      return service.updatePrivacyLevel(auth.userId, body.privacyLevel)
    },
  )

  // ─── Block / Unblock ──────────────────────────────────────────────────

  // POST /v1/users/me/block/:targetUserId — block a user
  app.post(
    '/v1/users/me/block/:targetUserId',
    {
      preHandler: [
        requireAuth('consumer'),
        rateLimitMiddleware({ key: 'block-user', max: 10, windowSeconds: 60 }),
        validate({ params: blockParamsSchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof blockParamsSchema>
      await service.blockUserAction(auth.userId, params.targetUserId)
      return reply.status(201).send({ success: true })
    },
  )

  // DELETE /v1/users/me/block/:targetUserId — unblock a user
  app.delete(
    '/v1/users/me/block/:targetUserId',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ params: blockParamsSchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof blockParamsSchema>
      await service.unblockUserAction(auth.userId, params.targetUserId)
      return reply.status(204).send()
    },
  )

  // GET /v1/users/me/blocks — list blocked users
  app.get(
    '/v1/users/me/blocks',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      const blocked = await service.listBlockedUsers(auth.userId)
      return { blocked }
    },
  )

  // ─── Reports ──────────────────────────────────────────────────────────

  // POST /v1/reports — submit a report
  app.post(
    '/v1/reports',
    {
      preHandler: [
        requireAuth('consumer'),
        rateLimitMiddleware({ key: 'submit-report', max: 5, windowSeconds: 300 }),
        validate({ body: createReportBodySchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof createReportBodySchema>
      const report = await service.submitReport({
        reporterId: auth.userId,
        reportedUserId: body.reportedUserId,
        category: body.category,
        description: body.description,
      })
      return reply.status(201).send(report)
    },
  )
}
