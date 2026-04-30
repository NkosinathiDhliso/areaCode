import Fastify from 'fastify'
import cors from '@fastify/cors'
import { AppError } from './shared/errors/AppError.js'
import { initSentry, captureError } from './shared/monitoring/sentry.js'
import { initPrivacyGuard } from './shared/privacy/privacy-guard.js'
import { getUserById } from './features/auth/dynamodb-repository.js'
import { isBlocked } from './features/social/block-repository.js'
import { isFollowing } from './features/social/repository.js'
import { businessRoutes } from './features/business/handler.js'
import { socialRoutes } from './features/social/handler.js'
import { nodeRoutes } from './features/nodes/handler.js'
import { rewardRoutes } from './features/rewards/handler.js'
import { checkInRoutes } from './features/check-in/handler.js'
import { authRoutes } from './features/auth/handler.js'
import { adminRoutes } from './features/admin/handler.js'
import { notificationRoutes } from './features/notifications/handler.js'
import { musicRoutes } from './features/music/handler.js'
import { staffRoutes } from './features/staff/handler.js'
import { privacyRoutes } from './features/privacy/handler.js'

export async function buildApp() {
  // Initialize error monitoring before anything else
  await initSentry()

  // Initialize PrivacyGuard with repository dependencies
  initPrivacyGuard({
    getUserById,
    isBlocked,
    areMutualFollows: async (userA: string, userB: string) => {
      const [forward, reverse] = await Promise.all([
        isFollowing(userA, userB),
        isFollowing(userB, userA),
      ])
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

  // CORS
  const isProd = process.env['AREA_CODE_ENV'] === 'prod'
  const amplifyOrigins = [
    'https://master.d3pm78r41ma6w6.amplifyapp.com',  // web
    'https://master.dbp54yxhyjvk0.amplifyapp.com',   // business
    'https://master.d166bb81tg4k61.amplifyapp.com',   // staff
    'https://master.d1ay6jict0ql9w.amplifyapp.com',   // admin
  ]
  void app.register(cors, {
    origin: isProd
      ? [
          'https://areacode.co.za',
          'https://www.areacode.co.za',
          'https://business.areacode.co.za',
          'https://staff.areacode.co.za',
          'https://admin.areacode.co.za',
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

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const body: Record<string, unknown> = {
        error: error.error,
        message: error.message,
        statusCode: error.statusCode,
      }
      if ('cooldownUntil' in error) {
        body['cooldownUntil'] = (
          error as AppError & { cooldownUntil: string }
        ).cooldownUntil
      }
      return reply.status(error.statusCode).send(body)
    }

    // Narrow to Error-like object for safe property access
    const err = error as Error & { name?: string; validation?: unknown; message?: string }

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

    app.log.error(error)
    captureError(error)
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
      timestamp: new Date().toISOString(),
    })
  })

  // Register all feature routes , await to catch registration errors
  await app.register(authRoutes)
  await app.register(nodeRoutes)
  await app.register(checkInRoutes)
  await app.register(rewardRoutes)
  await app.register(businessRoutes)
  await app.register(socialRoutes)
  await app.register(adminRoutes)
  await app.register(notificationRoutes)
  await app.register(musicRoutes)
  await app.register(staffRoutes)
  await app.register(privacyRoutes)

  return app
}
