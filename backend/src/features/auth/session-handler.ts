import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { AppError } from '../../shared/errors/AppError.js'
import * as sessionService from './session-service.js'
import * as service from './service.js'

export async function sessionRoutes(app: FastifyInstance) {
  // GET /v1/users/me/sessions
  app.get('/v1/users/me/sessions', { preHandler: [requireAuth('consumer', 'business', 'staff')] }, async (request) => {
    const auth = getAuth(request)
    const query = request.query as Record<string, unknown>
    const currentSessionId = query?.currentSessionId as string | undefined
    const sessions = await sessionService.getUserSessions(auth.userId, currentSessionId)
    return { sessions }
  })

  // DELETE /v1/users/me/sessions/:sessionId
  app.delete(
    '/v1/users/me/sessions/:sessionId',
    { preHandler: [requireAuth('consumer', 'business', 'staff')] },
    async (request, reply) => {
      const auth = getAuth(request)
      const { sessionId } = request.params as { sessionId: string }
      await sessionService.revokeSession(auth.userId, sessionId)
      return reply.status(200).send({ success: true })
    },
  )

  // POST /v1/users/me/sessions/revoke-all
  app.post(
    '/v1/users/me/sessions/revoke-all',
    { preHandler: [requireAuth('consumer', 'business', 'staff')] },
    async (request) => {
      const auth = getAuth(request)
      const body = (request.body as Record<string, unknown>) ?? {}
      const currentSessionId = body.currentSessionId
      if (!currentSessionId || typeof currentSessionId !== 'string') {
        throw AppError.badRequest('currentSessionId is required')
      }
      return sessionService.revokeAllOtherSessions(auth.userId, currentSessionId)
    },
  )
}
