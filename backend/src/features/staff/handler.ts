import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { AppError } from '../../shared/errors/AppError.js'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { getUserById } from '../auth/dynamodb-repository.js'
import { findRedemptionByCode, getRewardById } from '../rewards/repository.js'
import { getStaffRecentRedemptions, redeemReward } from '../rewards/service.js'

const codeParamsSchema = z.object({ code: z.string().min(1) })

export async function staffRoutes(app: FastifyInstance) {
  // GET /v1/staff/recent-redemptions
  app.get('/v1/staff/recent-redemptions', { preHandler: [requireAuth('staff')] }, async (request) => {
    const auth = getAuth(request)
    return getStaffRecentRedemptions(auth.userId)
  })

  // GET /v1/staff/redeem/:code/preview
  app.get(
    '/v1/staff/redeem/:code/preview',
    {
      preHandler: [requireAuth('staff'), validate({ params: codeParamsSchema })],
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
      preHandler: [requireAuth('staff'), validate({ params: codeParamsSchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof codeParamsSchema>
      return redeemReward(params.code, auth.userId)
    },
  )

  // ─── Guest claim: First-Get redeemed by walk-in without an account ──────
  // Churn-defences spec, Requirement 6.
  //
  // Token-based flow (post-SMS-deprecation):
  //   1. Walk-in customer claims a venue's First-Get at the till.
  //   2. Staff scans the First-Get QR / picks the reward in the staff app.
  //   3. We mint a one-time GUESTTOKEN (8 base32 chars) and show it to staff.
  //   4. Staff hands the customer the token (printed slip / screen photo /
  //      verbal). No PII is collected — phone-free, email-free.
  //   5. Customer signs up later with whatever email they want and enters
  //      the token on first launch. Token is exchanged for one historical
  //      visit credit.

  const firstGetIdParamsSchema = z.object({ rewardId: z.string().uuid() })

  // POST /v1/staff/first-get/:rewardId/confirm
  // Mints a token and returns it to the staff app for display / printing.
  app.post(
    '/v1/staff/first-get/:rewardId/confirm',
    {
      preHandler: [requireAuth('staff'), validate({ params: firstGetIdParamsSchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof firstGetIdParamsSchema>
      const reward = await getRewardById(params.rewardId)
      if (!reward) throw AppError.notFound('Reward not found')
      if (!(reward as { isFirstGet?: boolean }).isFirstGet) {
        throw AppError.badRequest('not_a_first_get')
      }
      const { getStaffById } = await import('../auth/dynamodb-repository.js')
      const staff = await getStaffById(auth.userId)
      if (!staff || staff.businessId !== reward.node?.businessId) {
        throw AppError.forbidden('You cannot redeem rewards for this business')
      }
      const { createGuestClaim } = await import('../rewards/guest-claim.js')
      const claim = await createGuestClaim({
        rewardId: params.rewardId,
        nodeId: reward.nodeId,
        staffId: auth.userId,
        ...(staff.name ? { staffName: staff.name } : {}),
      })
      return {
        success: true,
        token: claim.token,
        expiresAt: claim.conversionExpiresAt,
      }
    },
  )

  // GET /v1/staff/first-get — returns the First-Get reward for the staff
  // member's business, if any. Powers the "issue token" screen.
  app.get('/v1/staff/first-get', { preHandler: [requireAuth('staff')] }, async (request) => {
    const auth = getAuth(request)
    const { getStaffById } = await import('../auth/dynamodb-repository.js')
    const staff = await getStaffById(auth.userId)
    if (!staff?.businessId) return { reward: null }
    // Find the business's nodes, then any active First-Get reward across them.
    const { documentClient, TableNames } = await import('../../shared/db/dynamodb.js')
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb')
    const { getActiveRewardsByNodeId } = await import('../rewards/dynamodb-repository.js')
    const nodesResult = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.nodes,
        IndexName: 'BusinessIndex',
        KeyConditionExpression: 'businessId = :bid',
        ExpressionAttributeValues: { ':bid': staff.businessId },
      }),
    )
    const nodeIds = (nodesResult.Items ?? []).map((n) => n['nodeId'] as string)
    for (const nodeId of nodeIds) {
      const rewards = await getActiveRewardsByNodeId(nodeId)
      const firstGet = rewards.find((r) => (r as { isFirstGet?: boolean }).isFirstGet)
      if (firstGet) {
        return {
          reward: {
            rewardId: (firstGet as { rewardId?: string }).rewardId,
            title: firstGet.title,
            description: (firstGet as unknown as Record<string, unknown>)['description'] ?? '',
            nodeId,
          },
        }
      }
    }
    return { reward: null }
  })

  // GET /v1/staff/business — bootstrap read for the staff home. Returns the
  // business name and a server-derived lifecycle state so the staff app can show
  // the Lapsed_Business_Banner (cross-portal-lifecycle-alignment R3.1). No
  // polling, no socket — one read on load.
  app.get('/v1/staff/business', { preHandler: [requireAuth('staff')] }, async (request) => {
    const auth = getAuth(request)
    const { getStaffById } = await import('../auth/dynamodb-repository.js')
    const { findBusinessById } = await import('../business/repository.js')
    const { getEffectiveTier } = await import('../business/service.js')
    const staff = await getStaffById(auth.userId)
    if (!staff?.businessId) return { businessName: null, isActive: true, businessState: 'active' as const }
    const biz = await findBusinessById(staff.businessId)
    const isActive = biz ? (biz as unknown as Record<string, unknown>)['isActive'] !== false : false
    // Lapsed = demoted for non-payment (business inactive) or a paid stored tier
    // whose windows all lapsed to effective starter. A genuine starter/free
    // business is NOT lapsed. Earned codes still redeem in this state (R3.2), so
    // this only drives the banner, never a hard block.
    const storedTier = biz ? (((biz as unknown as Record<string, unknown>)['tier'] as string) ?? 'free') : 'free'
    const wasPaid = storedTier === 'growth' || storedTier === 'pro' || storedTier === 'payg'
    const effectiveStarter = biz ? getEffectiveTier(biz as never) === 'starter' : false
    const businessState: 'active' | 'lapsed' = biz && (!isActive || (wasPaid && effectiveStarter)) ? 'lapsed' : 'active'
    return { businessName: biz?.businessName ?? null, isActive, businessState }
  })
}
