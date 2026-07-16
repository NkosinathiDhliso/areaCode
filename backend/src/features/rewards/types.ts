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
 * Repeat_Policy (R1.1). `once` (default) = at most one redemption per consumer,
 * ever. `per_visit` = a consumer past the threshold can earn the get again on a
 * later visit, gated by the 4-hour Repeat_Window. Absent on disk reads as `once`.
 */
const repeatPolicyEnum = z.enum(['once', 'per_visit'])

/**
 * Repeat_Policy refinement (R1.3, R1.5). `per_visit` is accepted only for
 * loyalty `nth_checkin` gets. Any other category or type is rejected with a
 * `repeat_not_supported` error (surfaced as 400 by the handler's Zod mapping).
 *
 * `type` is only known here on create. On update the reward `type` is immutable
 * and not part of the body, so the update refinement can only reject an explicit
 * non-loyalty `getCategory`; the authoritative category+type check against the
 * persisted row lives in the service layer (task 6.2), mirroring the window
 * refinement's split.
 */
function refineRepeatPolicy(
  repeatPolicy: 'once' | 'per_visit' | undefined,
  category: 'loyalty' | 'event' | 'offer',
  type: string | undefined,
  ctx: z.RefinementCtx,
): void {
  if (repeatPolicy !== 'per_visit') return

  if (category !== 'loyalty' || type !== 'nth_checkin') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'repeat_not_supported: per_visit is only valid for loyalty nth_checkin gets',
      path: ['repeatPolicy'],
    })
  }
}

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
    /**
     * Repeat_Policy (R1.1, R1.5). Optional; absent → `once` in the service
     * layer. `per_visit` is valid only for loyalty `nth_checkin` gets (R1.3),
     * enforced by the refinement below.
     */
    repeatPolicy: repeatPolicyEnum.optional(),
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

    // Repeat_Policy: per_visit only on loyalty nth_checkin gets (R1.3, R1.4).
    refineRepeatPolicy(data.repeatPolicy, category, data.type, ctx)
  })

export const updateRewardBodySchema = z
  .object({
    title: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isActive: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    isFirstGet: z.boolean().optional(),
    /**
     * Loyalty check-in threshold. Editable so a venue can raise or lower the
     * bar on an existing reward. Existing consumers keep their grandfathered
     * Threshold_Lock (Churn-defences R1.2/R1.4); only new consumers see the
     * new value. The business portal warns the operator with a count of
     * affected customers before saving (R1.7).
     */
    triggerValue: z.number().int().positive().optional(),
    /**
     * Allows an update to (re)assert the get category. When the target is — or
     * becomes — an event/offer, the window refinement below applies (R1.3, R1.6).
     */
    getCategory: getCategoryEnum.optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    claimRequiresCheckIn: z.boolean().optional(),
    /**
     * Repeat_Policy (R1.1, R1.5). Optional on update. `per_visit` is valid only
     * for loyalty `nth_checkin` gets (R1.3). The reward `type` is immutable and
     * not part of this body, so the refinement below only rejects an explicit
     * non-loyalty `getCategory`; the authoritative category+type check against
     * the persisted row lives in the service layer (task 6.2).
     */
    repeatPolicy: repeatPolicyEnum.optional(),
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

    // Repeat_Policy: reject per_visit when the update explicitly targets a
    // non-loyalty category (R1.3, R1.4). The full loyalty+nth_checkin check
    // against the persisted row is enforced in the service layer (task 6.2).
    if (data.repeatPolicy === 'per_visit' && targetsEventOffer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'repeat_not_supported: per_visit is only valid for loyalty nth_checkin gets',
        path: ['repeatPolicy'],
      })
    }
  })

export const rewardIdParamsSchema = z.object({
  id: z.string().uuid(),
})

export const redeemBodySchema = z.object({
  code: z.string().length(8),
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
  /**
   * Repeat_Policy (R1.1). Optional on disk: existing rows lack it and are
   * interpreted as `once` by the read model, so no backfill is needed
   * (R1.2, R7.1). Valid as `per_visit` only on loyalty `nth_checkin` gets (R1.3).
   */
  repeatPolicy?: 'once' | 'per_visit'
  createdAt: string
  updatedAt: string
}

export interface RewardRedemption {
  redemptionId: string
  rewardId: string
  userId: string
  redemptionCode: string
  codeExpiresAt: string
  redeemedAt?: string | null
  businessId?: string
  nodeId?: string
  nodeName?: string
  rewardTitle?: string
  staffId?: string
  staffName?: string
  createdAt: string
}
