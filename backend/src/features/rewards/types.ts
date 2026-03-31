import { z } from 'zod'

export const createRewardBodySchema = z.object({
  nodeId: z.string().uuid(),
  type: z.enum(['nth_checkin', 'daily_first', 'streak', 'milestone']),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  triggerValue: z.number().int().positive().optional(),
  totalSlots: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const updateRewardBodySchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
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
