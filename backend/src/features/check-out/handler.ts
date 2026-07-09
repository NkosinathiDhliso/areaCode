import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'

import * as service from './service.js'
import { checkOutBodySchema } from './types.js'

export async function checkOutRoutes(app: FastifyInstance) {
  // POST /v1/check-out
  app.post(
    '/v1/check-out',
    {
      preHandler: [
        requireAuth('consumer'),
        rateLimitMiddleware({ key: 'check-out', max: 10, windowSeconds: 60 }),
        validate({ body: checkOutBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof checkOutBodySchema>
      return service.processCheckOut(auth.userId, body)
    },
  )
}
