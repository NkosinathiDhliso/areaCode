import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'

import * as service from './service.js'
import {
  accountTypeQuerySchema,
  staffInviteAcceptBodySchema,
  staffInviteMetaQuerySchema,
  consumerEmailSignupBodySchema,
  consumerSignupBodySchema,
  verifyOtpBodySchema,
  loginBodySchema,
  emailLoginBodySchema,
  refreshBodySchema,
  businessSignupBodySchema,
  businessEmailSignupBodySchema,
  businessOAuthCompleteProfileBodySchema,
  staffOAuthAcceptInviteBodySchema,
  staffInviteEmailAcceptBodySchema,
  adminLoginBodySchema,
} from './types.js'

export async function authRoutes(app: FastifyInstance) {
  // ─── Consumer Auth ──────────────────────────────────────────────────────

  // POST /v1/auth/consumer/signup
  app.post(
    '/v1/auth/consumer/email-signup',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'consumer-email-signup', max: 5, windowSeconds: 300 }),
        validate({ body: consumerEmailSignupBodySchema }),
      ],
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof consumerEmailSignupBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      const result = await service.consumerEmailSignup({ ...body, userAgent })
      return reply.status(201).send(result)
    },
  )

  app.post(
    '/v1/auth/consumer/signup',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'consumer-signup', max: 5, windowSeconds: 300 }),
        validate({ body: consumerSignupBodySchema }),
      ],
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof consumerSignupBodySchema>
      const result = await service.consumerSignup(body)
      return reply.status(201).send(result)
    },
  )

  // POST /v1/auth/consumer/login
  app.post(
    '/v1/auth/consumer/email-login',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'consumer-email-login', max: 5, windowSeconds: 60 }),
        validate({ body: emailLoginBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof emailLoginBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.consumerEmailLogin(body.email, body.password, userAgent)
    },
  )

  app.post(
    '/v1/auth/consumer/login',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'consumer-login', max: 5, windowSeconds: 60 }),
        validate({ body: loginBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof loginBodySchema>
      await service.consumerLogin(body.phone)
      return { success: true, message: 'OTP sent' }
    },
  )

  // POST /v1/auth/consumer/verify-otp
  app.post(
    '/v1/auth/consumer/verify-otp',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'consumer-verify-otp', max: 5, windowSeconds: 300 }),
        validate({ body: verifyOtpBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.consumerVerifyOtp(body.phone, body.code, userAgent)
    },
  )

  // POST /v1/auth/consumer/oauth-sync (after Cognito Hosted UI + Google)
  app.post(
    '/v1/auth/consumer/oauth-sync',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'consumer-oauth-sync', max: 10, windowSeconds: 60 }),
        requireAuth('consumer'),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const userAgent = request.headers['user-agent'] ?? ''
      return service.consumerOAuthSync({
        cognitoSub: auth.cognitoSub,
        email: auth.email,
        userAgent,
      })
    },
  )

  // POST /v1/auth/consumer/refresh
  app.post('/v1/auth/consumer/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'consumer')
  })

  // ─── Business Auth ────────────────────────────────────────────────────

  // POST /v1/auth/business/signup
  app.post(
    '/v1/auth/business/email-signup',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'business-email-signup', max: 5, windowSeconds: 300 }),
        validate({ body: businessEmailSignupBodySchema }),
      ],
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof businessEmailSignupBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      const result = await service.businessEmailSignup({ ...body, userAgent })
      return reply.status(201).send(result)
    },
  )

  app.post(
    '/v1/auth/business/signup',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'business-signup', max: 5, windowSeconds: 300 }),
        validate({ body: businessSignupBodySchema }),
      ],
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof businessSignupBodySchema>
      const result = await service.businessSignup(body)
      return reply.status(201).send(result)
    },
  )

  // POST /v1/auth/business/login
  app.post(
    '/v1/auth/business/email-login',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'business-email-login', max: 5, windowSeconds: 60 }),
        validate({ body: emailLoginBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof emailLoginBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.businessEmailLogin(body.email, body.password, userAgent)
    },
  )

  app.post(
    '/v1/auth/business/login',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'business-login', max: 5, windowSeconds: 60 }),
        validate({ body: loginBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof loginBodySchema>
      await service.businessLogin(body.phone)
      return { success: true, message: 'OTP sent' }
    },
  )

  // POST /v1/auth/business/verify-otp
  app.post(
    '/v1/auth/business/verify-otp',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'business-verify-otp', max: 5, windowSeconds: 300 }),
        validate({ body: verifyOtpBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.businessVerifyOtp(body.phone, body.code, userAgent)
    },
  )

  // POST /v1/auth/business/oauth-sync (after Hosted UI + Google)
  app.post(
    '/v1/auth/business/oauth-sync',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'business-oauth-sync', max: 10, windowSeconds: 60 }),
        requireAuth('business'),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const userAgent = request.headers['user-agent'] ?? ''
      return service.businessOAuthSync({ cognitoSub: auth.cognitoSub, userAgent })
    },
  )

  // POST /v1/auth/business/oauth-complete-profile (new Google business after oauth-sync)
  app.post(
    '/v1/auth/business/oauth-complete-profile',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'business-oauth-profile', max: 5, windowSeconds: 300 }),
        validate({ body: businessOAuthCompleteProfileBodySchema }),
        requireAuth('business'),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof businessOAuthCompleteProfileBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.businessOAuthCompleteProfile({
        cognitoSub: auth.cognitoSub,
        email: auth.email,
        userAgent,
        businessName: body.businessName,
        registrationNumber: body.registrationNumber,
      })
    },
  )

  // POST /v1/auth/business/refresh
  app.post('/v1/auth/business/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'business')
  })

  // ─── Staff Auth ───────────────────────────────────────────────────────

  // POST /v1/auth/staff/login
  app.post(
    '/v1/auth/staff/email-login',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'staff-email-login', max: 5, windowSeconds: 60 }),
        validate({ body: emailLoginBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof emailLoginBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.staffEmailLogin(body.email, body.password, userAgent)
    },
  )

  app.post(
    '/v1/auth/staff/login',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'staff-login', max: 5, windowSeconds: 60 }),
        validate({ body: loginBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof loginBodySchema>
      await service.staffLogin(body.phone)
      return { success: true, message: 'OTP sent' }
    },
  )

  // POST /v1/auth/staff/verify-otp
  app.post(
    '/v1/auth/staff/verify-otp',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'staff-verify-otp', max: 5, windowSeconds: 300 }),
        validate({ body: verifyOtpBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof verifyOtpBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.staffVerifyOtp(body.phone, body.code, userAgent)
    },
  )

  // POST /v1/auth/staff/oauth-sync
  app.post(
    '/v1/auth/staff/oauth-sync',
    {
      preHandler: [rateLimitMiddleware({ key: 'staff-oauth-sync', max: 10, windowSeconds: 60 }), requireAuth('staff')],
    },
    async (request) => {
      const auth = getAuth(request)
      const userAgent = request.headers['user-agent'] ?? ''
      return service.staffOAuthSync({ cognitoSub: auth.cognitoSub, userAgent })
    },
  )

  // POST /v1/auth/staff/oauth-accept-invite
  app.post(
    '/v1/auth/staff/oauth-accept-invite',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'staff-oauth-invite', max: 10, windowSeconds: 60 }),
        validate({ body: staffOAuthAcceptInviteBodySchema }),
        requireAuth('staff'),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof staffOAuthAcceptInviteBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      return service.staffOAuthAcceptInvite({
        cognitoSub: auth.cognitoSub,
        email: auth.email,
        inviteToken: body.inviteToken,
        name: body.name,
        userAgent,
      })
    },
  )

  // POST /v1/auth/staff/refresh
  app.post('/v1/auth/staff/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'staff')
  })

  // ─── Admin Auth ─────────────────────────────────────────────────────────

  // POST /v1/auth/admin/login
  app.post(
    '/v1/auth/admin/login',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'admin-login', max: 5, windowSeconds: 300 }),
        validate({ body: adminLoginBodySchema }),
      ],
    },
    async (request) => {
      const body = request.body as z.infer<typeof adminLoginBodySchema>
      return service.adminLogin(body.email, body.password)
    },
  )

  // POST /v1/auth/admin/oauth-sync (after Hosted UI + Google)
  app.post(
    '/v1/auth/admin/oauth-sync',
    {
      preHandler: [rateLimitMiddleware({ key: 'admin-oauth-sync', max: 10, windowSeconds: 60 }), requireAuth('admin')],
    },
    async (request) => {
      const auth = getAuth(request)
      return service.adminOAuthSync({ cognitoSub: auth.cognitoSub })
    },
  )

  // POST /v1/auth/admin/refresh
  app.post('/v1/auth/admin/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'admin')
  })

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

  // GET /v1/auth/staff-invite/meta
  app.get(
    '/v1/auth/staff-invite/meta',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'staff-invite-meta', max: 30, windowSeconds: 60 }),
        validate({ query: staffInviteMetaQuerySchema }),
      ],
    },
    async (request) => {
      const q = request.query as z.infer<typeof staffInviteMetaQuerySchema>
      return service.getStaffInviteMeta(q.token)
    },
  )

  // POST /v1/staff-invite/accept
  app.post(
    '/v1/staff-invite/email-accept',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'staff-invite-email-accept', max: 5, windowSeconds: 300 }),
        validate({ body: staffInviteEmailAcceptBodySchema }),
      ],
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof staffInviteEmailAcceptBodySchema>
      const userAgent = request.headers['user-agent'] ?? ''
      const staff = await service.acceptStaffInviteEmail({ ...body, userAgent })
      return reply.status(201).send(staff)
    },
  )

  app.post(
    '/v1/staff-invite/accept',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'staff-invite-accept', max: 5, windowSeconds: 300 }),
        validate({ body: staffInviteAcceptBodySchema }),
      ],
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof staffInviteAcceptBodySchema>
      const staff = await service.acceptStaffInvite(body.token, body.name, body.phone)
      return reply.status(201).send(staff)
    },
  )
}
