// Consumer auth routes
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  consumerEmailSignupBodySchema,
  consumerSignupBodySchema,
  verifyOtpBodySchema,
  loginBodySchema,
  emailLoginBodySchema,
  refreshBodySchema,
} from './types.js'

export async function registerConsumerRoutes(app: FastifyInstance) {
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

  app.post('/v1/auth/consumer/refresh', { preHandler: [validate({ body: refreshBodySchema })] }, async (request) => {
    const body = request.body as z.infer<typeof refreshBodySchema>
    return service.refreshToken(body.refreshToken, 'consumer')
  })
}
