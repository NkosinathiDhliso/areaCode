// Staff and Admin auth routes
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
  staffInviteEmailAcceptBodySchema,
  staffOAuthAcceptInviteBodySchema,
  adminLoginBodySchema,
  verifyOtpBodySchema,
  loginBodySchema,
  emailLoginBodySchema,
  refreshBodySchema,
} from './types.js'

export async function registerStaffAdminRoutes(app: FastifyInstance) {
  // ─── Staff Auth ───────────────────────────────────────────────────────

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

  app.post('/v1/auth/staff/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'staff')
  })

  // ─── Admin Auth ─────────────────────────────────────────────────────────

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

  app.post('/v1/auth/admin/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'admin')
  })

  // ─── Shared Routes ────────────────────────────────────────────────────

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

  app.post(
    '/v1/auth/logout',
    { preHandler: [requireAuth('consumer', 'business', 'staff', 'admin')] },
    async (request, reply) => {
      const auth = getAuth(request)
      const sessionId = (request.body as Record<string, unknown>)?.sessionId as string | undefined
      if (sessionId) {
        try {
          await service.deleteLoginSession(auth.userId, sessionId)
        } catch {
          // Best-effort
        }
      }
      try {
        await service.revokeUserTokens(auth.role, auth.cognitoSub)
      } catch {
        // Best-effort
      }
      return reply.status(200).send({ success: true })
    },
  )

  // ─── Staff Invite ─────────────────────────────────────────────────────

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
