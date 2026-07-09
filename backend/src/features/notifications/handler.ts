import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'

import * as service from './service.js'
import { pushTokenBodySchema, notificationPrefsSchema, notificationHistoryQuerySchema } from './types.js'

export async function notificationRoutes(app: FastifyInstance) {
  // POST /v1/users/me/push-token
  app.post(
    '/v1/users/me/push-token',
    {
      preHandler: [requireAuth('consumer', 'business'), validate({ body: pushTokenBodySchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof pushTokenBodySchema>
      await service.registerPushToken(auth.userId, body.token, body.platform, body.deviceId)
      return reply.status(201).send({ success: true })
    },
  )

  // GET /v1/users/me/notification-preferences
  app.get('/v1/users/me/notification-preferences', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    return service.getPreferences(auth.userId)
  })

  // PATCH /v1/users/me/notification-preferences
  app.patch(
    '/v1/users/me/notification-preferences',
    {
      preHandler: [requireAuth('consumer'), validate({ body: notificationPrefsSchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof notificationPrefsSchema>
      return service.updatePreferences(auth.userId, body)
    },
  )

  // GET /v1/users/me/notifications — paginated notification history
  app.get(
    '/v1/users/me/notifications',
    {
      preHandler: [requireAuth('consumer'), validate({ query: notificationHistoryQuerySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof notificationHistoryQuerySchema>
      return service.getNotificationHistory(auth.userId, {
        limit: query.limit,
        cursor: query.cursor,
      })
    },
  )

  // POST /v1/users/me/notifications/mark-read — mark all visible notifications as read
  app.post('/v1/users/me/notifications/mark-read', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    const result = await service.markAllNotificationsAsRead(auth.userId)
    return { success: true, updatedCount: result.updatedCount }
  })
}
