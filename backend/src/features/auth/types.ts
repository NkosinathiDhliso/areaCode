import { z } from 'zod'

export const updateProfileBodySchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  citySlug: z.string().min(1).optional(),
})

export const consentBodySchema = z.object({
  consentVersion: z.string().min(1),
  analyticsOptIn: z.boolean(),
  broadcastLocation: z.boolean(),
})

export const checkInHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
})

export const consumerSignupBodySchema = z.object({
  phone: z.string().regex(/^\+\d{10,15}$/, 'E.164 format required'),
  username: z.string().min(3).max(30),
  displayName: z.string().min(1).max(50),
  citySlug: z.string().min(1),
})

export const verifyOtpBodySchema = z.object({
  phone: z.string().regex(/^\+\d{10,15}$/),
  code: z.string().length(6),
})

export const loginBodySchema = z.object({
  phone: z.string().regex(/^\+\d{10,15}$/),
})

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
})

export const businessSignupBodySchema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^\+\d{10,15}$/),
  businessName: z.string().min(1).max(100),
  registrationNumber: z.string().optional(),
})

export const staffInviteAcceptBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(100),
  phone: z.string().regex(/^\+\d{10,15}$/),
})

export const accountTypeQuerySchema = z.object({
  phone: z.string().regex(/^\+\d{10,15}$/),
})
