import { z } from 'zod'

/**
 * Maximum Active_Window width for an Event_Get/Offer_Get (R1.6): 30 days.
 * Mirrored from `lifecycle.ts`'s `validateWindow` so the Zod refinement can
 * enforce the clock-independent window rules (ordering + 30-day ceiling)
 * without importing a clock. The full not-in-past / clock-skew check (R2.4)
 * lives in the service layer where the current time is available.
 */
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Reward `type` enum — the loyalty check-in triggers. Unchanged. */
const rewardTypeEnum = z.enum(['nth_checkin', 'daily_first', 'streak', 'milestone'])

/** Get category discriminator (R1.1). Absent → treated as `loyalty`. */
const getCategoryEnum = z.enum(['loyalty', 'event', 'offer'])

/**
 * Shared window refinement for event/offer gets (R1.3, R1.6).
 *
 * Enforces the clock-independent rules only — both bounds present, parseable,
 * `startsAt < endsAt`, and `endsAt - startsAt <= 30 days`. The `starts_in_past`
 * check (R2.4) needs the current time and is enforced in the service layer.
 */
function refineEventOfferWindow(startsAt: string | undefined, endsAt: string | undefined, ctx: z.RefinementCtx): void {
  if (!startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'startsAt is required for event and offer gets',
      path: ['startsAt'],
    })
  }
  if (!endsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endsAt is required for event and offer gets',
      path: ['endsAt'],
    })
  }
  if (!startsAt || !endsAt) return

  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)

  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'invalid_window: startsAt must be a valid timestamp before endsAt',
      path: ['endsAt'],
    })
    return
  }

  if (end - start > MAX_WINDOW_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'window_too_long: the active window must not exceed 30 days',
      path: ['endsAt'],
    })
  }
}

export const createRewardBodySchema = z
  .object({
    nodeId: z.string().uuid(),
    /**
     * Loyalty check-in trigger. Optional now (R1.4): required for loyalty gets
     * via the refinement below, optional for event/offer gets (the service
     * defaults an omitted `type` to the `getCategory`).
     */
    type: rewardTypeEnum.optional(),
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    triggerValue: z.number().int().positive().optional(),
    totalSlots: z.number().int().positive().optional(),
    expiresAt: z.string().datetime().optional(),
    /**
     * Marks this reward as the venue's introductory "First-Get" — claimable
     * by walk-in customers who don't yet have an account.
     * Churn-defences spec, Requirement 6. Only one reward per node may have
     * this set; the service layer enforces uniqueness.
     */
    isFirstGet: z.boolean().optional(),
    /**
     * Get category (R1.1). Absent → `loyalty` (resolved in the service layer).
     */
    getCategory: getCategoryEnum.optional(),
    /** Active_Window start, ISO-8601 UTC. Required for event/offer (R1.3). */
    startsAt: z.string().datetime().optional(),
    /** Active_Window end, ISO-8601 UTC. Required for event/offer (R1.3). */
    endsAt: z.string().datetime().optional(),
    /** Claim-on-check-in flag (R1.5). Defaults to `true` in the service layer. */
    claimRequiresCheckIn: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const category = data.getCategory ?? 'loyalty'

    if (category === 'event' || category === 'offer') {
      // Event/offer gets require a valid Active_Window (R1.3, R1.6).
      refineEventOfferWindow(data.startsAt, data.endsAt, ctx)
    } else {
      // Loyalty gets preserve today's contract: `type` is required (R1.2).
      if (!data.type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'type is required for loyalty gets',
          path: ['type'],
        })
      }
    }
  })

export const updateRewardBodySchema = z
  .object({
    title: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isActive: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    isFirstGet: z.boolean().optional(),
    /**
     * Allows an update to (re)assert the get category. When the target is — or
     * becomes — an event/offer, the window refinement below applies (R1.3, R1.6).
     */
    getCategory: getCategoryEnum.optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    claimRequiresCheckIn: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const targetsEventOffer = data.getCategory === 'event' || data.getCategory === 'offer'
    const touchesWindow = data.startsAt !== undefined || data.endsAt !== undefined

    // Re-validate the window when the update targets an event/offer, or when it
    // touches either window bound. The service layer (task 4.1) does the
    // authoritative re-validation against the persisted row, including the
    // clock-dependent not-in-past check.
    if (targetsEventOffer || touchesWindow) {
      refineEventOfferWindow(data.startsAt, data.endsAt, ctx)
    }
  })

export const rewardIdParamsSchema = z.object({
  id: z.string().uuid(),
})

export const redeemBodySchema = z.object({
  code: z.string().length(6),
})

export const nearMeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

// ============================================================================
// DynamoDB Entity Types
// ============================================================================

export interface Reward {
  rewardId: string
  nodeId: string
  type: string
  title: string
  description?: string
  triggerValue?: number
  totalSlots?: number
  claimedCount: number
  slotsLocked: boolean
  isActive: boolean
  expiresAt?: string
  /** See createRewardBodySchema.isFirstGet. */
  isFirstGet?: boolean
  /**
   * Get category discriminator (R1.1). Optional on disk: existing rows lack it
   * and are interpreted as `loyalty` by the read model, so no backfill is
   * needed (R7.1, R7.2).
   */
  getCategory?: 'loyalty' | 'event' | 'offer'
  /** Active_Window start, ISO-8601 UTC. Present for event/offer gets (R1.3). */
  startsAt?: string
  /** Active_Window end, ISO-8601 UTC. Present for event/offer gets (R1.3). */
  endsAt?: string
  /** Claim-on-check-in flag for event/offer gets, defaults `true` (R1.5). */
  claimRequiresCheckIn?: boolean
  createdAt: string
  updatedAt: string
}

export interface RewardRedemption {
  redemptionId: string
  rewardId: string
  userId: string
  redemptionCode: string
  codeExpiresAt: string
  redeemedAt?: string
  createdAt: string
}
