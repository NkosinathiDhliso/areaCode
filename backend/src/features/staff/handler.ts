import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { getStaffRecentRedemptions, redeemReward } from '../rewards/service.js'
import { findRedemptionByCode, getRewardById } from '../rewards/repository.js'
import { z } from 'zod'
import { AppError } from '../../shared/errors/AppError.js'
import { getUserById } from '../auth/dynamodb-repository.js'

const codeParamsSchema = z.object({ code: z.string().min(1) })

export async function staffRoutes(app: FastifyInstance) {
  // GET /v1/staff/recent-redemptions
  app.get(
    '/v1/staff/recent-redemptions',
    { preHandler: [requireAuth('staff')] },
    async (request) => {
      const auth = getAuth(request)
      return getStaffRecentRedemptions(auth.userId)
    },
  )

  // GET /v1/staff/redeem/:code/preview
  app.get(
    '/v1/staff/redeem/:code/preview',
    {
      preHandler: [
        requireAuth('staff'),
        validate({ params: codeParamsSchema }),
      ],
    },
    async (request) => {
      const params = request.params as z.infer<typeof codeParamsSchema>
      const redemption = await findRedemptionByCode(params.code)
      if (!redemption) throw AppError.badRequest('invalid_code')
      if (redemption.redeemedAt) throw AppError.badRequest('already_redeemed')
      if (redemption.codeExpiresAt && redemption.codeExpiresAt < new Date().toISOString()) {
        throw AppError.badRequest('expired_code')
      }

      // Get reward details
      const reward = redemption.rewardId ? await getRewardById(redemption.rewardId) : null

      // Get consumer display info (privacy-safe)
      let consumerDisplayName = 'Unknown'
      let consumerTier = 'local'
      if (redemption.userId) {
        const user = await getUserById(redemption.userId)
        if (user) {
          consumerDisplayName = user.displayName ?? user.username ?? 'Unknown'
          consumerTier = user.tier ?? 'local'
        }
      }

      return {
        rewardTitle: reward?.title ?? redemption.reward?.title ?? '',
        rewardType: (reward as Record<string, unknown>)?.['type'] ?? '',
        rewardDescription: (reward as Record<string, unknown>)?.['description'] ?? '',
        consumerDisplayName,
        consumerTier,
      }
    },
  )

  // POST /v1/staff/redeem/:code/confirm
  app.post(
    '/v1/staff/redeem/:code/confirm',
    {
      preHandler: [
        requireAuth('staff'),
        validate({ params: codeParamsSchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof codeParamsSchema>
      return redeemReward(params.code, auth.userId)
    },
  )

  // GET /v1/staff/business — returns the business name for the staff member's business
  app.get(
    '/v1/staff/business',
    { preHandler: [requireAuth('staff')] },
    async (request) => {
      const auth = getAuth(request)
      const { getStaffById } = await import('../auth/dynamodb-repository.js')
      const { findBusinessById } = await import('../business/repository.js')
      const staff = await getStaffById(auth.userId)
      if (!staff?.businessId) return { businessName: null, isActive: true }
      const biz = await findBusinessById(staff.businessId)
      const isActive = biz ? (biz as unknown as Record<string, unknown>)['isActive'] !== false : false
      return { businessName: biz?.businessName ?? null, isActive }
    },
  )
}
