import cors from '@fastify/cors'
import Fastify from 'fastify'

import { adminRoutes } from './features/admin/handler.js'
import { getUserById } from './features/auth/dynamodb-repository.js'
import { checkInRoutes } from './features/check-in/handler.js'
import { authRoutes } from './features/auth/handler.js'
import { sessionRoutes } from './features/auth/session-handler.js'
import { profileRoutes } from './features/auth/profile-handler.js'
import { businessRoutes } from './features/business/handler.js'
import { notificationRoutes } from './features/notifications/handler.js'
import { musicRoutes } from './features/music/handler.js'
import { nodeRoutes } from './features/nodes/handler.js'
import { deltaRoutes } from './features/nodes/delta-handler.js'
import { privacyRoutes } from './features/privacy/handler.js'
import { reportRoutes } from './features/reports/handler.js'
import { signalRoutes } from './features/signals/handler.js'
import { rewardRoutes } from './features/rewards/handler.js'
import { isBlocked } from './features/social/block-repository.js'
import { socialRoutes } from './features/social/handler.js'
import { isFollowing } from './features/social/repository.js'
import { staffRoutes } from './features/staff/handler.js'
import { AppError } from './shared/errors/AppError.js'
import { globalRateLimitHook } from './shared/middleware/rate-limit.js'
import { initSentry, captureError } from './shared/monitoring/sentry.js'
import { createRequestLogger, logger } from './shared/monitoring/logger.js'
import { initPrivacyGuard } from './shared/privacy/privacy-guard.js'

export async function buildApp() {
  // Initialize error monitoring before anything else
  await initSentry()

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

  // Security Headers (CSP, HSTS)
  await app.register(import('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https://*'],
        connectSrc: ["'self'", 'https://*'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
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

  // CORS
  const isProd = process.env['AREA_CODE_ENV'] === 'prod'
  const amplifyOrigins = [
    'https://master.d3pm78r41ma6w6.amplifyapp.com', // web
    'https://master.dbp54yxhyjvk0.amplifyapp.com', // business
    'https://master.d166bb81tg4k61.amplifyapp.com', // staff
    'https://master.d1ay6jict0ql9w.amplifyapp.com', // admin
  ]
  await app.register(cors, {
    origin: isProd
      ? [
          'https://areacode.co.za',
          'https://www.areacode.co.za',
          'https://business.areacode.co.za',
          'https://www.business.areacode.co.za',
          'https://staff.areacode.co.za',
          'https://www.staff.areacode.co.za',
          'https://admin.areacode.co.za',
          'https://www.admin.areacode.co.za',
          ...amplifyOrigins,
        ]
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          'http://localhost:3003',
          'http://localhost:4000',
          ...amplifyOrigins,
        ],
    credentials: false,
  })

  // ─── Security Headers ───────────────────────────────────────────────────────
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
    if (isProd) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://api.areacode.co.za wss://ws.areacode.co.za https://exp.host; frame-ancestors 'none'",
      )
    }
  })

  // ─── Structured Logger per Request ──────────────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    const requestId = (request.headers['x-amzn-requestid'] as string) ?? request.id ?? ''
    const correlationId = (request.headers['x-correlation-id'] as string) ?? requestId
    ;(request as unknown as { log: ReturnType<typeof createRequestLogger> }).log = createRequestLogger({
      service: 'api',
      requestId,
      correlationId,
    })
  })

  // ─── Global Rate Limiting ─────────────────────────────────────────────────────
  app.addHook('preHandler', globalRateLimitHook())

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    const requestId = (request.headers['x-amzn-requestid'] as string) ?? request.id ?? ''
    const reqLogger = (request as unknown as { log?: ReturnType<typeof createRequestLogger> }).log ?? logger

    if (error instanceof AppError) {
      // Log warnings for client errors (rate limits, auth failures, validation)
      if (error.statusCode === 429) {
        reqLogger.warn('Rate limit exceeded', { error: error.error, path: request.url })
      } else if (error.statusCode === 401 || error.statusCode === 403) {
        reqLogger.warn('Authorization failure', { error: error.error, path: request.url, statusCode: error.statusCode })
      } else if (error.statusCode === 400) {
        reqLogger.warn('Validation failure', { error: error.error, path: request.url })
      } else if (error.statusCode >= 500) {
        reqLogger.error('Server error', { error: error.error, path: request.url, statusCode: error.statusCode })
      }

      const body: Record<string, unknown> = {
        error: error.error,
        message: error.message,
        statusCode: error.statusCode,
        requestId,
      }
      if ('cooldownUntil' in error) {
        body['cooldownUntil'] = (error as AppError & { cooldownUntil: string }).cooldownUntil
      }
      if ('fields' in error) {
        body['fields'] = (error as AppError & { fields: unknown }).fields
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
      if (err.statusCode === 429) {
        reqLogger.warn('Rate limit exceeded', { path: request.url })
      } else {
        reqLogger.warn('Client error', { path: request.url, statusCode: err.statusCode, message: err.message })
      }
      return reply.status(err.statusCode).send({
        error: 'bad_request',
        message: err.message ?? 'Invalid request',
        statusCode: err.statusCode,
        requestId,
      })
    }

    if (err.name === 'ZodError') {
      reqLogger.warn('Validation failure', { path: request.url, error: 'ZodError' })
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid request data',
        statusCode: 400,
        requestId,
      })
    }

    if (err.validation) {
      reqLogger.warn('Validation failure', { path: request.url })
      return reply.status(400).send({
        error: 'validation_error',
        message: err.message ?? 'Validation failed',
        statusCode: 400,
        requestId,
      })
    }

    // Unhandled exception — log at error level
    reqLogger.error('Unhandled exception', {
      path: request.url,
      errorName: err.name,
      errorMessage: err.message,
    })
    captureError(error)
    return reply.status(500).send({
      error: 'internal_error',
      message: 'Internal server error',
      statusCode: 500,
      requestId,
    })
  })

  // Health check , no auth, no rate limit
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      env: process.env['AREA_CODE_ENV'] ?? 'unknown',
      version: '0.0.1',
      timestamp: new Date().toISOString(),
    })
  })

  // WebSocket health endpoint — returns active connection count, connections by room type, and uptime
  app.get('/v1/health/websocket', async (_request, reply) => {
    const { getWebSocketHealth } = await import('./features/admin/websocket-health-service.js')
    const health = await getWebSocketHealth()
    return reply.send(health)
  })

  // Register all feature routes , await to catch registration errors
  await app.register(authRoutes)
  await app.register(sessionRoutes)
  await app.register(profileRoutes)
  await app.register(nodeRoutes)
  await app.register(deltaRoutes)
  await app.register(checkInRoutes)
  await app.register(rewardRoutes)
  await app.register(businessRoutes)
  await app.register(socialRoutes)
  await app.register(adminRoutes)
  await app.register(notificationRoutes)
  await app.register(musicRoutes)
  await app.register(staffRoutes)
  await app.register(signalRoutes)
  await app.register(privacyRoutes)
  await app.register(reportRoutes)

  return app
}
