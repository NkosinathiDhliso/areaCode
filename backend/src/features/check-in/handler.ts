import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'

import { CHECK_IN_ROUTE_RATE_LIMIT, VENUE_OPEN_RATE_LIMIT } from './rate-limits.js'
import * as service from './service.js'
import { checkInBodySchema, venueOpenBodySchema, venueOpenParamsSchema } from './types.js'
import { recordVenueOpen } from './venue-open.js'

export async function checkInRoutes(app: FastifyInstance) {
  // POST /v1/check-in
  app.post(
    '/v1/check-in',
    {
      preHandler: [
        requireAuth('consumer'),
        rateLimitMiddleware(CHECK_IN_ROUTE_RATE_LIMIT),
        validate({ body: checkInBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof checkInBodySchema>
      return service.processCheckIn(auth.userId, body)
    },
  )

  // POST /v1/nodes/:nodeId/open — Venue_Open (proof-of-demand R2.1, R2.5).
  //
  // Registered with the check-in feature, not the nodes feature, because the
  // row it writes is one half of the Found_Via stamp the check-in service
  // reads: the writer, the reader and the Away_Gate stay in one module so the
  // stored shape and the rule that judges it cannot drift.
  //
  // Nothing is returned. The consumer app does not render the row, and an
  // empty response keeps the endpoint from becoming a read of a consumer's own
  // browsing history.
  app.post(
    '/v1/nodes/:nodeId/open',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ params: venueOpenParamsSchema, body: venueOpenBodySchema }),
        rateLimitMiddleware(VENUE_OPEN_RATE_LIMIT),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof venueOpenParamsSchema>
      const body = request.body as z.infer<typeof venueOpenBodySchema>
      await recordVenueOpen(auth.userId, params.nodeId, body)
      return reply.status(204).send()
    },
  )
}
