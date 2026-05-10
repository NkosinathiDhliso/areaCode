// Business auth routes
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  businessSignupBodySchema,
  businessEmailSignupBodySchema,
  businessOAuthCompleteProfileBodySchema,
  verifyOtpBodySchema,
  loginBodySchema,
  emailLoginBodySchema,
  refreshBodySchema,
} from './types.js'

export async function registerBusinessRoutes(app: FastifyInstance) {
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

  app.post('/v1/auth/business/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'business')
  })
}
