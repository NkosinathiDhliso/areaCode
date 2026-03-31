import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import { pushTokenBodySchema, notificationPrefsSchema } from './types.js'
import { z } from 'zod'

export async function notificationRoutes(app: FastifyInstance) {
  // POST /v1/users/me/push-token
  app.post(
    '/v1/users/me/push-token',
    {
      preHandler: [
        requireAuth('consumer', 'business'),
        validate({ body: pushTokenBodySchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof pushTokenBodySchema>
      await service.registerPushToken(
        auth.userId,
        body.token,
        body.platform,
        body.deviceId,
      )
      return reply.status(201).send({ success: true })
    },
  )

  // GET /v1/users/me/notification-preferences
  app.get(
    '/v1/users/me/notification-preferences',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getPreferences(auth.userId)
    },
  )

  // PATCH /v1/users/me/notification-preferences
  app.patch(
    '/v1/users/me/notification-preferences',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ body: notificationPrefsSchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof notificationPrefsSchema>
      return service.updatePreferences(auth.userId, body)
    },
  )
}
