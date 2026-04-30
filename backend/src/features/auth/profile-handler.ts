import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  updateProfileBodySchema, consentBodySchema, checkInHistoryQuerySchema,
} from './types.js'
import { z } from 'zod'
import { TIER_LEVELS, getTier } from '@area-code/shared/constants/tier-levels'
import type { TierLevel } from '@area-code/shared/constants/tier-levels'

export async function profileRoutes(app: FastifyInstance) {
  // GET /v1/users/me
  app.get(
    '/v1/users/me',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getUserProfile(auth.cognitoSub)
    },
  )

  // PATCH /v1/users/me
  app.patch(
    '/v1/users/me',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ body: updateProfileBodySchema }),
      ],
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
      preHandler: [
        requireAuth('consumer'),
        validate({ query: checkInHistoryQuerySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof checkInHistoryQuerySchema>
      return service.getCheckInHistory(auth.userId, query.cursor, query.limit)
    },
  )

  // DELETE /v1/users/me/check-in-history
  app.delete(
    '/v1/users/me/check-in-history',
    { preHandler: [requireAuth('consumer')] },
    async (request, reply) => {
      const auth = getAuth(request)
      await service.deleteCheckInHistory(auth.userId)
      return reply.status(204).send()
    },
  )

  // GET /v1/users/me/tier-progress
  app.get(
    '/v1/users/me/tier-progress',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      const profile = await service.getUserProfile(auth.cognitoSub)
      const totalCheckIns = (profile as Record<string, unknown>).totalCheckIns as number ?? 0
      const currentTier = getTier(totalCheckIns)

      const currentLevel = TIER_LEVELS.find((l: TierLevel) => l.tier === currentTier)!
      const currentIdx = TIER_LEVELS.indexOf(currentLevel)
      const nextLevel = currentIdx < TIER_LEVELS.length - 1 ? TIER_LEVELS[currentIdx + 1] : null

      const tierBenefits: Record<string, string[]> = {
        local: ['Access to basic rewards'],
        regular: ['Priority reward access', 'Profile badge'],
        fixture: ['Exclusive venue rewards', 'Leaderboard boost'],
        institution: ['VIP rewards', 'Early access to new venues'],
        legend: ['All benefits unlocked', 'Legend-only rewards', 'Permanent leaderboard status'],
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
    },
  )

  // GET /v1/users/me/streak
  app.get(
    '/v1/users/me/streak',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      const profile = await service.getUserProfile(auth.cognitoSub) as Record<string, unknown>
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
    },
  )

  // PUT /v1/users/me/consent
  app.put(
    '/v1/users/me/consent',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ body: consentBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof consentBodySchema>
      return service.updateConsent(auth.userId, body.consentVersion, body.analyticsOptIn)
    },
  )

  // DELETE /v1/users/me (POPIA right-to-erasure)
  app.delete(
    '/v1/users/me',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      return service.requestAccountDeletion(auth.userId)
    },
  )

  // POST /v1/users/me/onboarding/complete
  app.post(
    '/v1/users/me/onboarding/complete',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      await service.completeOnboarding(auth.userId)
      return { success: true }
    },
  )
}
