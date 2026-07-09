import { z } from 'zod'

export const userIdParamsSchema = z.object({ userId: z.string().uuid() })
export const businessIdParamsSchema = z.object({ businessId: z.string().uuid() })
export const nodeIdParamsSchema = z.object({ nodeId: z.string().uuid() })

export const adminMessageBodySchema = z.object({
  message: z.string().min(1).max(1000),
})

export const overrideStreakBodySchema = z.object({
  streakCount: z.number().int().min(0),
  reason: z.string().min(1, 'Reason is mandatory'),
})

export const extendTrialBodySchema = z.object({
  days: z.number().int().min(1).max(30),
})

// Admin set-tier (cross-portal-lifecycle-alignment R1). A comped paid tier is a
// Paid_Until window written directly (the Comp_Window), so the Tier_Resolver
// honours it with no resolver branch. Paid tiers therefore REQUIRE a future
// entitlement end date; starter forbids one (the business must read as starter).
export const setTierBodySchema = z
  .object({
    tier: z.enum(['starter', 'growth', 'pro']),
    reason: z.string().min(1).max(500),
    paidUntil: z.string().datetime().optional(),
  })
  .superRefine((val, ctx) => {
    const isPaid = val.tier === 'growth' || val.tier === 'pro'
    if (isPaid) {
      if (!val.paidUntil) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paidUntil'],
          message: 'Paid tiers require an entitlement end date',
        })
        return
      }
      if (new Date(val.paidUntil).getTime() <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paidUntil'],
          message: 'Entitlement end date must be in the future',
        })
      }
    } else if (val.paidUntil) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paidUntil'],
        message: 'Starter tier cannot have an entitlement end date',
      })
    }
  })

export const reportActionBodySchema = z.object({
  action: z.enum(['reviewed', 'dismissed', 'actioned']),
})

export const reportIdParamsSchema = z.object({ reportId: z.string().uuid() })

export const abuseFlagIdParamsSchema = z.object({ flagId: z.string().uuid() })

export type AdminRole = 'super_admin' | 'support_agent' | 'content_moderator'
