import Fastify from 'fastify'
import cors from '@fastify/cors'
import { AppError } from './shared/errors/AppError.js'
import { businessRoutes } from './features/business/handler.js'
import { socialRoutes } from './features/social/handler.js'
import { nodeRoutes } from './features/nodes/handler.js'
import { rewardRoutes } from './features/rewards/handler.js'
import { checkInRoutes } from './features/check-in/handler.js'
import { authRoutes } from './features/auth/handler.js'
import { adminRoutes } from './features/admin/handler.js'
import { notificationRoutes } from './features/notifications/handler.js'
import { musicRoutes } from './features/music/handler.js'

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env['AREA_CODE_ENV'] === 'prod' ? 'info' : 'debug',
    },
  })

  // CORS
  const isProd = process.env['AREA_CODE_ENV'] === 'prod'
  void app.register(cors, {
    origin: isProd
      ? [
          'https://areacode.co.za',
          'https://business.areacode.co.za',
          'https://staff.areacode.co.za',
          'https://admin.areacode.co.za',
        ]
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          'http://localhost:3003',
        ],
    credentials: true,
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
    return reply.status(500).send({
      error: 'internal_error',
      message: 'Internal server error',
      statusCode: 500,
    })
  })

  // Health check — no auth, no rate limit
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      env: process.env['AREA_CODE_ENV'] ?? 'unknown',
      version: '0.0.1',
      timestamp: new Date().toISOString(),
    })
  })

  // Register all feature routes
  void app.register(authRoutes)
  void app.register(nodeRoutes)
  void app.register(checkInRoutes)
  void app.register(rewardRoutes)
  void app.register(businessRoutes)
  void app.register(socialRoutes)
  void app.register(adminRoutes)
  void app.register(notificationRoutes)
  void app.register(musicRoutes)

  return app
}
