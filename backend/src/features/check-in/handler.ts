import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import * as service from './service.js'
import { checkInBodySchema } from './types.js'
import { z } from 'zod'

export async function checkInRoutes(app: FastifyInstance) {
  // POST /v1/check-in
  app.post(
    '/v1/check-in',
    {
      preHandler: [
        requireAuth('consumer'),
        rateLimitMiddleware({ key: 'check-in', max: 10, windowSeconds: 60 }),
        validate({ body: checkInBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof checkInBodySchema>
      return service.processCheckIn(auth.userId, body)
    },
  )
}
