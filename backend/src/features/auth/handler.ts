import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import * as service from './service.js'
import {
  updateProfileBodySchema, consentBodySchema, checkInHistoryQuerySchema,
  accountTypeQuerySchema, staffInviteAcceptBodySchema,
  consumerSignupBodySchema, verifyOtpBodySchema, loginBodySchema,
  refreshBodySchema, businessSignupBodySchema, adminLoginBodySchema,
} from './types.js'
import { z } from 'zod'

export async function authRoutes(app: FastifyInstance) {
  // ─── Consumer Auth ──────────────────────────────────────────────────────

  // POST /v1/auth/consumer/signup
  app.post(
    '/v1/auth/consumer/signup',
    { preHandler: [
      rateLimitMiddleware({ key: 'consumer-signup', max: 5, windowSeconds: 300 }),
      validate({ body: consumerSignupBodySchema }),
    ] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof consumerSignupBodySchema>
      const result = await service.consumerSignup(body)
      return reply.status(201).send(result)
    },
  )

  // POST /v1/auth/consumer/login
  app.post(
    '/v1/auth/consumer/login',
    { preHandler: [
      rateLimitMiddleware({ key: 'consumer-login', max: 5, windowSeconds: 60 }),
      validate({ body: loginBodySchema }),
    ] },
    async (request) => {
      const body = request.body as z.infer<typeof loginBodySchema>
      await service.consumerLogin(body.phone)
      return { success: true, message: 'OTP sent' }
    },
  )

  // POST /v1/auth/consumer/verify-otp
  app.post(
    '/v1/auth/consumer/verify-otp',
    { preHandler: [validate({ body: verifyOtpBodySchema })] },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      return service.consumerVerifyOtp(body.phone, body.code)
    },
  )

  // POST /v1/auth/consumer/refresh
  app.post(
    '/v1/auth/consumer/refresh',
    { preHandler: [validate({ body: refreshBodySchema })] },
    async (request) => {
      const body = request.body as z.infer<typeof refreshBodySchema>
      return service.refreshToken(body.refreshToken, 'consumer')
    },
  )

  // ─── Business Auth ────────────────────────────────────────────────────

  // POST /v1/auth/business/signup
  app.post(
    '/v1/auth/business/signup',
    { preHandler: [
      rateLimitMiddleware({ key: 'business-signup', max: 5, windowSeconds: 300 }),
      validate({ body: businessSignupBodySchema }),
    ] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof businessSignupBodySchema>
      const result = await service.businessSignup(body)
      return reply.status(201).send(result)
    },
  )

  // POST /v1/auth/business/login
  app.post(
    '/v1/auth/business/login',
    { preHandler: [
      rateLimitMiddleware({ key: 'business-login', max: 5, windowSeconds: 60 }),
      validate({ body: loginBodySchema }),
    ] },
    async (request) => {
      const body = request.body as z.infer<typeof loginBodySchema>
      await service.businessLogin(body.phone)
      return { success: true, message: 'OTP sent' }
    },
  )

  // POST /v1/auth/business/verify-otp
  app.post(
    '/v1/auth/business/verify-otp',
    { preHandler: [validate({ body: verifyOtpBodySchema })] },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      return service.businessVerifyOtp(body.phone, body.code)
    },
  )

  // ─── Staff Auth ───────────────────────────────────────────────────────

  // POST /v1/auth/staff/login
  app.post(
    '/v1/auth/staff/login',
    { preHandler: [
      rateLimitMiddleware({ key: 'staff-login', max: 5, windowSeconds: 60 }),
      validate({ body: loginBodySchema }),
    ] },
    async (request) => {
      const body = request.body as z.infer<typeof loginBodySchema>
      await service.staffLogin(body.phone)
      return { success: true, message: 'OTP sent' }
    },
  )

  // POST /v1/auth/staff/verify-otp
  app.post(
    '/v1/auth/staff/verify-otp',
    { preHandler: [validate({ body: verifyOtpBodySchema })] },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      return service.staffVerifyOtp(body.phone, body.code)
    },
  )

  // ─── Admin Auth ─────────────────────────────────────────────────────────

  // POST /v1/auth/admin/login
  app.post(
    '/v1/auth/admin/login',
    { preHandler: [validate({ body: adminLoginBodySchema })] },
    async (request) => {
      const body = request.body as z.infer<typeof adminLoginBodySchema>
      return service.adminLogin(body.email, body.password)
    },
  )

  // ─── User Profile & Consent ───────────────────────────────────────────

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
      return service.updateConsent(
        auth.userId,
        body.consentVersion,
        body.analyticsOptIn,
      )
    },
  )

  // GET /v1/auth/account-type
  app.get(
    '/v1/auth/account-type',
    {
      preHandler: [
        validate({ query: accountTypeQuerySchema }),
        rateLimitMiddleware({ key: 'account-type', max: 5, windowSeconds: 60 }),
      ],
    },
    async (request) => {
      const query = request.query as z.infer<typeof accountTypeQuerySchema>
      const type = await service.getAccountType(query.phone)
      return { accountType: type }
    },
  )

  // POST /v1/auth/logout
  app.post(
    '/v1/auth/logout',
    { preHandler: [requireAuth('consumer', 'business', 'staff', 'admin')] },
    async (request, reply) => {
      const auth = getAuth(request)
      // Revoke all tokens for this user in Cognito
      try {
        await service.revokeUserTokens(auth.role, auth.cognitoSub)
      } catch {
        // Best-effort — don't fail the logout if revocation fails
      }
      return reply.status(200).send({ success: true })
    },
  )

  // DELETE /v1/users/me — POPIA right-to-erasure
  app.delete(
    '/v1/users/me',
    { preHandler: [requireAuth('consumer')] },
    async (request) => {
      const auth = getAuth(request)
      return service.requestAccountDeletion(auth.userId)
    },
  )

  // POST /v1/staff-invite/accept
  app.post(
    '/v1/staff-invite/accept',
    { preHandler: [validate({ body: staffInviteAcceptBodySchema })] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof staffInviteAcceptBodySchema>
      const staff = await service.acceptStaffInvite(body.token, body.name, body.phone)
      return reply.status(201).send(staff)
    },
  )
}
