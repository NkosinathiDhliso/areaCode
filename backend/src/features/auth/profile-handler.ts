import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import { updateProfileBodySchema, consentBodySchema, checkInHistoryQuerySchema } from './types.js'
import { z } from 'zod'
import { TIER_LEVELS, getTier } from '@area-code/shared/constants/tier-levels'
import type { TierLevel } from '@area-code/shared/constants/tier-levels'

export async function profileRoutes(app: FastifyInstance) {
  // GET /v1/users/me
  app.get('/v1/users/me', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    return service.getUserProfile(auth.cognitoSub)
  })

  // PATCH /v1/users/me
  app.patch(
    '/v1/users/me',
    {
      preHandler: [requireAuth('consumer'), validate({ body: updateProfileBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof updateProfileBodySchema>
      return service.updateProfile(auth.userId, body)
    },
  )

  // GET /v1/users/me/check-in-history
  app.get(
    '/v1/users/me/check-in-history',
    {
      preHandler: [requireAuth('consumer'), validate({ query: checkInHistoryQuerySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof checkInHistoryQuerySchema>
      return service.getCheckInHistory(auth.userId, query.cursor, query.limit)
    },
  )

  // GET /v1/users/me/visited
  // Powers the consumer-side GPS-proximity nudge (Churn-defences spec, Req 4).
  // Returns deduplicated venue coords only — no PII, no timestamps.
  app.get('/v1/users/me/visited', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    return service.getVisitedNodes(auth.userId)
  })

  // POST /v1/users/me/redeem-guest-token
  // Exchanges a one-time First-Get token for one historical visit credit.
  // Token issued by staff at the till; customer enters it in-app post-signup.
  // (Churn-defences spec, Requirement 6 — token-based variant.)
  const guestTokenSchema = z.object({
    token: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9A-HJKMNP-TV-Z]{8}$/, 'Invalid token format'),
  })
  app.post(
    '/v1/users/me/redeem-guest-token',
    { preHandler: [requireAuth('consumer'), validate({ body: guestTokenSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof guestTokenSchema>
      const credited = await service.redeemGuestToken(body.token, auth.userId)
      return { success: credited }
    },
  )

  // DELETE /v1/users/me/check-in-history
  app.delete('/v1/users/me/check-in-history', { preHandler: [requireAuth('consumer')] }, async (request, reply) => {
    const auth = getAuth(request)
    await service.deleteCheckInHistory(auth.userId)
    return reply.status(204).send()
  })

  // GET /v1/users/me/tier-progress
  app.get('/v1/users/me/tier-progress', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    const profile = await service.getUserProfile(auth.cognitoSub)
    const totalCheckIns = ((profile as Record<string, unknown>).totalCheckIns as number) ?? 0
    const currentTier = getTier(totalCheckIns)

    const currentLevel = TIER_LEVELS.find((l: TierLevel) => l.tier === currentTier)!
    const currentIdx = TIER_LEVELS.indexOf(currentLevel)
    const nextLevel = currentIdx < TIER_LEVELS.length - 1 ? TIER_LEVELS[currentIdx + 1] : null

    // Benefits audit (honest-presence: under-claim, never over-claim). Only
    // capabilities backed by working code today are listed; a line that cannot
    // be pointed at shipped functionality is removed, not softened.
    // Backed today:
    //   - 'Access to basic rewards': GET /v1/rewards/near-me + claim flow,
    //     available to every consumer.
    //   - 'Profile badge': the rank badge (TierBadge) rendered on the profile.
    // Removed as aspirational (no code gates rewards, leaderboard, or venue
    // access by consumer rank): 'Priority reward access', 'Exclusive venue
    // rewards', 'Leaderboard boost', 'VIP rewards', 'Early access to new
    // venues', 'All benefits unlocked', 'Legend-only rewards', 'Permanent
    // leaderboard status'.
    const tierBenefits: Record<string, string[]> = {
      local: ['Access to basic rewards'],
      regular: ['Profile badge'],
      fixture: [],
      institution: [],
      legend: [],
    }

    return {
      currentTier,
      nextTier: nextLevel?.tier ?? null,
      currentCheckIns: totalCheckIns,
      nextTierThreshold: nextLevel?.minCheckIns ?? null,
      checkInsRemaining: nextLevel ? Math.max(0, nextLevel.minCheckIns - totalCheckIns) : 0,
      benefits: tierBenefits[currentTier] ?? [],
      tiers: TIER_LEVELS.map((l: TierLevel) => ({
        tier: l.tier,
        label: l.label,
        minCheckIns: l.minCheckIns,
        maxCheckIns: l.maxCheckIns,
        colour: l.colour,
        benefits: tierBenefits[l.tier] ?? [],
      })),
    }
  })

  // GET /v1/users/me/streak
  app.get('/v1/users/me/streak', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    const profile = (await service.getUserProfile(auth.cognitoSub)) as Record<string, unknown>
    const streakCount = (profile.streakCount as number) ?? 0
    const streakStartDate = (profile.streakStartDate as string) ?? null

    // At-risk: streak > 0 AND last check-in date (SAST) is before today (SAST)
    let atRisk = false
    if (streakCount > 0) {
      const history = await service.getCheckInHistory(auth.userId, undefined, 1)
      if (history.items.length > 0) {
        const lastCheckIn = new Date((history.items[0] as { checkedInAt: string }).checkedInAt)
        const sastOffset = 2 * 60 * 60 * 1000
        const lastCheckInSAST = new Date(lastCheckIn.getTime() + sastOffset)
        const nowSAST = new Date(Date.now() + sastOffset)
        const lastCheckInDate = lastCheckInSAST.toISOString().slice(0, 10)
        const todayDate = nowSAST.toISOString().slice(0, 10)
        atRisk = lastCheckInDate < todayDate
      } else {
        atRisk = true
      }
    }

    return { streakCount, streakStartDate, atRisk }
  })

  // PUT /v1/users/me/consent
  app.put(
    '/v1/users/me/consent',
    {
      preHandler: [requireAuth('consumer'), validate({ body: consentBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof consentBodySchema>
      return service.updateConsent(auth.userId, body.consentVersion, body.analyticsOptIn)
    },
  )

  // DELETE /v1/users/me (POPIA right-to-erasure)
  app.delete('/v1/users/me', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    return service.requestAccountDeletion(auth.userId)
  })

  // GET /v1/users/me/data-export (POPIA full data export)
  app.get('/v1/users/me/data-export', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    return service.getFullDataExport(auth.userId)
  })

  // POST /v1/users/me/onboarding/complete
  app.post('/v1/users/me/onboarding/complete', { preHandler: [requireAuth('consumer')] }, async (request) => {
    const auth = getAuth(request)
    await service.completeOnboarding(auth.userId)
    return { success: true }
  })
}
