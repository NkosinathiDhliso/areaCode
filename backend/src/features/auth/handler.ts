import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import * as service from './service.js'
import {
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
    { preHandler: [
      rateLimitMiddleware({ key: 'consumer-verify-otp', max: 5, windowSeconds: 300 }),
      validate({ body: verifyOtpBodySchema }),
    ] },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.consumerVerifyOtp(body.phone, body.code, userAgent)
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
    { preHandler: [
      rateLimitMiddleware({ key: 'business-verify-otp', max: 5, windowSeconds: 300 }),
      validate({ body: verifyOtpBodySchema }),
    ] },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.businessVerifyOtp(body.phone, body.code, userAgent)
    },
  )

  // POST /v1/auth/business/refresh
  app.post(
    '/v1/auth/business/refresh',
    { preHandler: [validate({ body: refreshBodySchema })] },
    async (request) => {
      const body = request.body as z.infer<typeof refreshBodySchema>
      return service.refreshToken(body.refreshToken, 'business')
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
    { preHandler: [
      rateLimitMiddleware({ key: 'staff-verify-otp', max: 5, windowSeconds: 300 }),
      validate({ body: verifyOtpBodySchema }),
    ] },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.staffVerifyOtp(body.phone, body.code, userAgent)
    },
  )

  // POST /v1/auth/staff/refresh
  app.post(
    '/v1/auth/staff/refresh',
    { preHandler: [validate({ body: refreshBodySchema })] },
    async (request) => {
      const body = request.body as z.infer<typeof refreshBodySchema>
      return service.refreshToken(body.refreshToken, 'staff')
    },
  )

  // ─── Admin Auth ─────────────────────────────────────────────────────────

  // POST /v1/auth/admin/login
  app.post(
    '/v1/auth/admin/login',
    { preHandler: [
      rateLimitMiddleware({ key: 'admin-login', max: 5, windowSeconds: 300 }),
      validate({ body: adminLoginBodySchema }),
    ] },
    async (request) => {
      const body = request.body as z.infer<typeof adminLoginBodySchema>
      return service.adminLogin(body.email, body.password)
    },
  )

  // ─── User Profile & Consent ───────────────────────────────────────────
  // Profile, tier-progress, streak, consent, history routes are in profile-handler.ts

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
      // Delete session record if sessionId provided
      const sessionId = (request.body as Record<string, unknown>)?.sessionId as string | undefined
      if (sessionId) {
        try {
          await service.deleteLoginSession(auth.userId, sessionId)
        } catch {
          // Best-effort
        }
      }
      // Revoke all tokens for this user in Cognito
      try {
        await service.revokeUserTokens(auth.role, auth.cognitoSub)
      } catch {
        // Best-effort, don't fail the logout if revocation fails
      }
      return reply.status(200).send({ success: true })
    },
  )

  // ─── Session Management ─────────────────────────────────────────────────
  // Session routes are in session-handler.ts

  // Staff invite and remaining routes

  // POST /v1/staff-invite/accept
  app.post(
    '/v1/staff-invite/accept',
    { preHandler: [
      rateLimitMiddleware({ key: 'staff-invite-accept', max: 5, windowSeconds: 300 }),
      validate({ body: staffInviteAcceptBodySchema }),
    ] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof staffInviteAcceptBodySchema>
      const staff = await service.acceptStaffInvite(body.token, body.name, body.phone)
      return reply.status(201).send(staff)
    },
  )
}
