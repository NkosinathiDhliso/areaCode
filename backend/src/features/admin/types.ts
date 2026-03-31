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

export const impersonateBodySchema = z.object({
  targetUserId: z.string().uuid(),
  targetAccountType: z.enum(['consumer', 'business', 'staff']),
  note: z.string().min(1, 'Note is mandatory'),
})

export const extendTrialBodySchema = z.object({
  days: z.number().int().min(1).max(30),
})

export const reportActionBodySchema = z.object({
  action: z.enum(['reviewed', 'dismissed', 'actioned']),
})

export const reportIdParamsSchema = z.object({ reportId: z.string().uuid() })

export const abuseFlagIdParamsSchema = z.object({ flagId: z.string().uuid() })

export type AdminRole = 'super_admin' | 'support_agent' | 'content_moderator'
