import { z } from 'zod'

export const updateProfileBodySchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  citySlug: z.string().min(1).optional(),
})

export const consentBodySchema = z
  .object({
    consentVersion: z.string().min(1),
    analyticsOptIn: z.boolean(),
  })
  .strict()

export const checkInHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
})

export const consumerSignupBodySchema = z.object({
  phone: z.string().regex(/^\+\d{10,15}$/, 'E.164 format required'),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, and underscores'),
  displayName: z.string().min(1).max(50).trim(),
  citySlug: z.string().min(1),
  consentAnalytics: z.boolean().optional().default(false),
})

export const consumerEmailSignupBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  consentAnalytics: z.boolean().optional().default(false),
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

export const businessEmailSignupBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  businessName: z.string().min(1).max(100),
  registrationNumber: z.string().optional(),
})

export const emailLoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
})

export const staffInviteAcceptBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(100),
  phone: z.string().regex(/^\+\d{10,15}$/),
})

export const staffInviteEmailAcceptBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(256),
})

export const staffInviteMetaQuerySchema = z.object({
  token: z.string().min(1),
})

export const businessOAuthCompleteProfileBodySchema = z.object({
  businessName: z.string().min(1).max(100),
  registrationNumber: z.string().optional(),
})

export const staffOAuthAcceptInviteBodySchema = z.object({
  inviteToken: z.string().min(1),
  name: z.string().min(1).max(100),
})

export const accountTypeQuerySchema = z.object({
  phone: z.string().regex(/^\+\d{10,15}$/),
})

// Email verification (non-blocking). The token is the single-use proof, so the
// confirm route needs no auth; resend is authenticated.
export const verifyEmailBodySchema = z.object({
  token: z.string().min(1).max(256),
})

export const adminLoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
})

// Admin TOTP MFA challenge responses. The session is the opaque Cognito session
// returned by the login challenge; the code is the 6-digit authenticator code.
export const adminMfaBodySchema = z.object({
  email: z.string().email(),
  session: z.string().min(1).max(8192),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
})

// ============================================================================
// DynamoDB Entity Types
// ============================================================================

export interface User {
  id?: string
  userId: string
  phone?: string
  email?: string
  username: string
  displayName: string
  avatarUrl?: string | null
  cityId?: string
  neighbourhoodId?: string
  tier?: string
  totalCheckIns?: number
  streakCount?: number
  cognitoSub?: string
  musicGenres?: string[]
  dimensionScores?: Record<string, unknown>
  archetypeId?: string
  streamingProvider?: string
  genresUpdatedAt?: string
  privacyLevel?: string
  isDisabled?: boolean
  disabledAt?: string
  emailVerified?: boolean
  onboardingComplete?: boolean
  streakStartDate?: string
  createdAt: string
  updatedAt?: string
}

export interface BusinessAccount {
  id?: string
  businessId: string
  email: string
  phone?: string
  businessName: string
  registrationNumber?: string
  cognitoSub?: string
  tier?: string
  trialEndsAt?: string
  paymentGraceUntil?: string
  yocoCustomerId?: string
  isActive?: boolean
  createdAt: string
  updatedAt?: string
}

export interface StaffAccount {
  id?: string
  staffId: string
  businessId: string
  name: string
  /** Present for phone-OTP staff; optional when created via Google invite. */
  phone?: string
  email?: string
  cognitoSub?: string
  /** Role within the business: 'manager' has portal access, 'staff' can only redeem codes. */
  role?: 'manager' | 'staff'
  isActive: boolean
  createdAt: string
}
