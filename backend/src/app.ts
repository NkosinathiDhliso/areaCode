import cors from '@fastify/cors'
import Fastify from 'fastify'

import { adminRoutes } from './features/admin/handler.js'
import { getUserById } from './features/auth/dynamodb-repository.js'
import { authRoutes } from './features/auth/handler.js'
import { profileRoutes } from './features/auth/profile-handler.js'
import { businessRoutes } from './features/business/handler.js'
import { campaignRoutes, campaignConsumerRoutes } from './features/campaigns/handler.js'
import { checkInRoutes } from './features/check-in/handler.js'
import { checkOutRoutes } from './features/check-out/handler.js'
import { eventRoutes } from './features/events/handler.js'
import { musicRoutes } from './features/music/handler.js'
import { nodeRoutes } from './features/nodes/handler.js'
import { nodeImageRoutes } from './features/nodes/image-routes.js'
import { nodeSocialRoutes } from './features/nodes/social-routes.js'
import { notificationRoutes } from './features/notifications/handler.js'
import { privacyRoutes } from './features/privacy/handler.js'
import { reportRoutes } from './features/reports/handler.js'
import { rewardRoutes } from './features/rewards/handler.js'
import { isBlocked } from './features/social/block-repository.js'
import { socialRoutes } from './features/social/handler.js'
import { isFollowing } from './features/social/repository.js'
import { staffRoutes } from './features/staff/handler.js'
import { assertStartupConfig } from './shared/config/env.js'
import { AppError } from './shared/errors/AppError.js'
import { initPrivacyGuard } from './shared/privacy/privacy-guard.js'

export async function buildApp() {
  // Fail fast at cold start on missing security-critical config (QR HMAC secret,
  // consent version) so a misdeploy crashes at init, not on first request.
  assertStartupConfig()

  // Initialize PrivacyGuard with repository dependencies
  initPrivacyGuard({
    getUserById,
    isBlocked,
    areMutualFollows: async (userA: string, userB: string) => {
      const [forward, reverse] = await Promise.all([isFollowing(userA, userB), isFollowing(userB, userA)])
      return forward && reverse
    },
  })

  const app = Fastify({
    logger: {
      level: process.env['AREA_CODE_ENV'] === 'prod' ? 'info' : 'debug',
    },
  })

  // Capture raw body for webhook signature verification
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.url === '/v1/webhooks/yoco') {
      const chunks: Buffer[] = []
      for await (const chunk of payload) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      }
      const rawBody = Buffer.concat(chunks)
      ;(request as unknown as { rawBody: string }).rawBody = rawBody.toString('utf-8')
      // Return a new readable stream from the buffer for Fastify to parse
      const { Readable } = await import('node:stream')
      return Readable.from(rawBody)
    }
    return payload
  })

  // Security headers — HSTS in production only (localhost is http).
  const isProdEnv = process.env['AREA_CODE_ENV'] === 'prod'
  app.addHook('onSend', async (_request, reply) => {
    if (isProdEnv) {
      void reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    void reply.header('X-Content-Type-Options', 'nosniff')
    void reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    // This is a JSON API: responses are never rendered as documents, so a
    // lockdown CSP and frame denial are safe (they can't break API clients)
    // and close clickjacking / resource-injection vectors on error pages or
    // any accidental HTML response. Frontend (document) CSP is configured at
    // the Amplify hosting layer, not here.
    void reply.header('X-Frame-Options', 'DENY')
    void reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  })

  // CORS
  const { allowedOrigins } = await import('./shared/security/origins.js')
  await app.register(cors, {
    origin: allowedOrigins(),
    credentials: false,
  })

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const body: Record<string, unknown> = {
        error: error.error,
        message: error.message,
        statusCode: error.statusCode,
      }
      if ('cooldownUntil' in error) {
        body['cooldownUntil'] = (error as AppError & { cooldownUntil: string }).cooldownUntil
      }
      if ('remaining' in error && typeof (error as AppError & { remaining: unknown }).remaining === 'number') {
        body['remaining'] = (error as AppError & { remaining: number }).remaining
      }
      return reply.status(error.statusCode).send(body)
    }

    // Narrow to Error-like object for safe property access
    const err = error as Error & {
      code?: string
      name?: string
      statusCode?: number
      validation?: unknown
      message?: string
    }

    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: 'bad_request',
        message: err.message ?? 'Invalid request',
        statusCode: err.statusCode,
      })
    }

    if (err.name === 'ZodError') {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid request data',
        statusCode: 400,
      })
    }

    if (err.validation) {
      return reply.status(400).send({
        error: 'validation_error',
        message: err.message ?? 'Validation failed',
        statusCode: 400,
      })
    }

    // AWS SDK errors (Cognito, DynamoDB, SQS) carry their HTTP status on
    // `$metadata`, not a top-level `statusCode`. A 4xx here is a client-side
    // problem (bad input, conditional check, throttling), not a server crash —
    // return the real status with a safe generic message instead of a scary
    // 500. We never echo the raw AWS message, to avoid leaking internals.
    const awsStatus = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (typeof awsStatus === 'number' && awsStatus >= 400 && awsStatus < 500) {
      app.log.warn({ err: error }, 'AWS client error mapped to 4xx')
      return reply.status(awsStatus).send({
        error: 'bad_request',
        message: 'Please check your details and try again.',
        statusCode: awsStatus,
      })
    }

    // Structured error logged to CloudWatch; the prod error-log alarm alerts
    // on these. This is the one monitoring path (no Sentry).
    app.log.error(error)
    return reply.status(500).send({
      error: 'internal_error',
      message: 'Internal server error',
      statusCode: 500,
    })
  })

  // Health check , no auth, no rate limit
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      env: process.env['AREA_CODE_ENV'] ?? 'unknown',
      version: '0.0.1',
      // Baked into the bundle by build.mts (esbuild define). Dot access is
      // required for the define substitution; unbuilt (local dev / tests) the
      // token is undefined and we report 'dev'.
      commit: process.env.AREA_CODE_BUILD_SHA ?? 'dev',
      timestamp: new Date().toISOString(),
    })
  })

  // Register all feature routes , await to catch registration errors
  await app.register(authRoutes)
  await app.register(profileRoutes)
  await app.register(nodeRoutes)
  await app.register(nodeImageRoutes)
  await app.register(nodeSocialRoutes)
  await app.register(checkInRoutes)
  await app.register(checkOutRoutes)
  await app.register(eventRoutes)
  await app.register(rewardRoutes)
  await app.register(businessRoutes)
  await app.register(socialRoutes)
  await app.register(adminRoutes)
  await app.register(notificationRoutes)
  await app.register(musicRoutes)
  await app.register(staffRoutes)
  await app.register(privacyRoutes)
  await app.register(reportRoutes)
  await app.register(campaignRoutes)
  await app.register(campaignConsumerRoutes)

  return app
}
