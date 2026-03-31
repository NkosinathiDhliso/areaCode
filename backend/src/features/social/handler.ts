import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth, getOptionalAuth, optionalAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import * as service from './service.js'
import {
  followParamsSchema,
  feedQuerySchema,
  leaderboardParamsSchema,
  nearbyRecentQuerySchema,
} from './types.js'
import { z } from 'zod'

export async function socialRoutes(app: FastifyInstance) {
  // POST /v1/users/:id/follow
  app.post(
    '/v1/users/:id/follow',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ params: followParamsSchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof followParamsSchema>
      await service.followUser(auth.userId, params.id)
      return reply.status(201).send({ success: true })
    },
  )

  // DELETE /v1/users/:id/follow
  app.delete(
    '/v1/users/:id/follow',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ params: followParamsSchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof followParamsSchema>
      await service.unfollowUser(auth.userId, params.id)
      return reply.status(204).send()
    },
  )

  // GET /v1/feed
  app.get(
    '/v1/feed',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ query: feedQuerySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof feedQuerySchema>
      return service.getActivityFeed(auth.userId, query.cursor, query.limit)
    },
  )

  // GET /v1/feed/nearby-recent
  app.get(
    '/v1/feed/nearby-recent',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ query: nearbyRecentQuerySchema }),
        rateLimitMiddleware({ key: 'nearby-recent', max: 10, windowSeconds: 60 }),
      ],
    },
    async (request) => {
      const query = request.query as z.infer<typeof nearbyRecentQuerySchema>
      return service.getNearbyRecentEvent(
        query.lat,
        query.lng,
        query.radiusMetres,
        query.withinMinutes,
      )
    },
  )

  // GET /v1/leaderboard/:citySlug
  app.get(
    '/v1/leaderboard/:citySlug',
    {
      preHandler: [
        optionalAuth('consumer'),
        validate({ params: leaderboardParamsSchema }),
      ],
    },
    async (request) => {
      const auth = getOptionalAuth(request)
      const params = request.params as z.infer<typeof leaderboardParamsSchema>
      return service.getCityLeaderboard(params.citySlug, auth?.userId)
    },
  )
}
