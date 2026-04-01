import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  createRewardBodySchema, updateRewardBodySchema,
  rewardIdParamsSchema, redeemBodySchema, nearMeQuerySchema,
} from './types.js'
import { z } from 'zod'

export async function rewardRoutes(app: FastifyInstance) {
  // POST /v1/business/rewards
  app.post(
    '/v1/business/rewards',
    {
      preHandler: [
        requireAuth('business'),
        validate({ body: createRewardBodySchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof createRewardBodySchema>
      const reward = await service.createReward(auth.userId, body)
      return reply.status(201).send(reward)
    },
  )

  // PUT /v1/business/rewards/:id
  app.put(
    '/v1/business/rewards/:id',
    {
      preHandler: [
        requireAuth('business'),
        validate({ params: rewardIdParamsSchema, body: updateRewardBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof rewardIdParamsSchema>
      const body = request.body as z.infer<typeof updateRewardBodySchema>
      return service.updateReward(params.id, auth.userId, body)
    },
  )

  // GET /v1/rewards/near-me
  app.get(
    '/v1/rewards/near-me',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ query: nearMeQuerySchema }),
      ],
    },
    async (request) => {
      const query = request.query as z.infer<typeof nearMeQuerySchema>
      return service.getRewardsNearMe(query.lat, query.lng)
    },
  )

  // GET /v1/users/me/unclaimed-rewards
  app.get(
    '/v1/users/me/unclaimed-rewards',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getUnclaimedRewards(auth.userId)
    },
  )

  // POST /v1/rewards/:rewardId/redeem (staff auth)
  app.post(
    '/v1/rewards/:id/redeem',
    {
      preHandler: [
        requireAuth('staff'),
        validate({ params: rewardIdParamsSchema, body: redeemBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof redeemBodySchema>
      return service.redeemReward(body.code, auth.userId)
    },
  )
}
