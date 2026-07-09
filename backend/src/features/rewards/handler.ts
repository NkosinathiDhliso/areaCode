import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { requireBusinessPermission, getBusinessRole } from '../../shared/middleware/business-role.js'
import { validate } from '../../shared/middleware/validation.js'

import * as service from './service.js'
import {
  createRewardBodySchema,
  updateRewardBodySchema,
  rewardIdParamsSchema,
  redeemBodySchema,
  nearMeQuerySchema,
} from './types.js'

export async function rewardRoutes(app: FastifyInstance) {
  // POST /v1/business/rewards — owners and managers (manage_rewards)
  app.post(
    '/v1/business/rewards',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_rewards'),
        validate({ body: createRewardBodySchema }),
      ],
    },
    async (request, reply) => {
      const businessId = getBusinessRole(request).businessId
      const body = request.body as z.infer<typeof createRewardBodySchema>
      const reward = await service.createReward(businessId, body)
      return reply.status(201).send(reward)
    },
  )

  // PUT /v1/business/rewards/:id — owners and managers (manage_rewards)
  app.put(
    '/v1/business/rewards/:id',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_rewards'),
        validate({ params: rewardIdParamsSchema, body: updateRewardBodySchema }),
      ],
    },
    async (request) => {
      const businessId = getBusinessRole(request).businessId
      const params = request.params as z.infer<typeof rewardIdParamsSchema>
      const body = request.body as z.infer<typeof updateRewardBodySchema>
      return service.updateReward(params.id, businessId, body)
    },
  )

  // GET /v1/business/rewards/:id/lock-count — owners and managers (view_rewards).
  // Returns how many consumers hold a grandfathered Threshold_Lock for this
  // reward, so the portal can warn the operator before a threshold change
  // (Churn-defences R1.7).
  app.get(
    '/v1/business/rewards/:id/lock-count',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('view_rewards'),
        validate({ params: rewardIdParamsSchema }),
      ],
    },
    async (request) => {
      const businessId = getBusinessRole(request).businessId
      const params = request.params as z.infer<typeof rewardIdParamsSchema>
      return service.getRewardLockCount(params.id, businessId)
    },
  )

  // GET /v1/rewards/near-me
  app.get(
    '/v1/rewards/near-me',
    {
      preHandler: [requireAuth('consumer'), validate({ query: nearMeQuerySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof nearMeQuerySchema>
      // viewerId powers the taste-match signal (archetype affinity + friends present).
      return service.getRewardsNearMe(query.lat, query.lng, auth.userId)
    },
  )

  // GET /v1/users/me/unclaimed-rewards
  app.get('/v1/users/me/unclaimed-rewards', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    return service.getUnclaimedRewards(auth.userId)
  })

  // POST /v1/rewards/:rewardId/redeem (staff auth)
  app.post(
    '/v1/rewards/:id/redeem',
    {
      preHandler: [requireAuth('staff'), validate({ params: rewardIdParamsSchema, body: redeemBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof redeemBodySchema>
      return service.redeemReward(body.code, auth.userId)
    },
  )
}
