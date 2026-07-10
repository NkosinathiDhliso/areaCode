import type { FastifyInstance } from 'fastify'

import { requireAuth } from '../../shared/middleware/auth.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'

import * as service from './service.js'
import { eventBatchBodySchema, type EventBatchBody } from './types.js'

export async function eventRoutes(app: FastifyInstance) {
  // POST /v1/events
  //
  // Consented usage instrumentation sink (R4.4). Handler order per tech.md:
  //   1. consumer JWT verify (only signed-in consumers may emit; the client
  //      beacon also hard-gates on analyticsOptIn, this is defence in depth),
  //   2. Zod body validation (max 20 events, each name on the shared allowlist,
  //      props a closed no-free-text set) which rejects an unknown name or
  //      oversized batch with the typed 400 (R4.5),
  //   3. rate limit (30 requests / 60s per client).
  //
  // The service emits CloudWatch EMF metric lines and never persists events, so
  // there is no DB or socket step. Always returns 204 on an accepted batch.
  app.post(
    '/v1/events',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ body: eventBatchBodySchema }),
        rateLimitMiddleware({ key: 'events', max: 30, windowSeconds: 60 }),
      ],
    },
    async (request, reply) => {
      const body = request.body as EventBatchBody
      service.recordEvents(body.events)
      return reply.status(204).send()
    },
  )
}
