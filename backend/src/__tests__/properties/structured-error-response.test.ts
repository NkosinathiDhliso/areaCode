/**
 * Property 22: Structured Error Response
 *
 * For any error thrown within a request handler, the HTTP response SHALL contain
 * fields `error` (string code), `message` (human-readable), and `statusCode` (number),
 * and SHALL NOT contain stack traces, internal file paths, or raw exception details.
 *
 * **Validates: Requirements 11.8**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fc from 'fast-check'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { AppError } from '../../shared/errors/AppError.js'

// Patterns that indicate stack trace or internal path exposure
const STACK_TRACE_PATTERNS = [
  /at\s+\S+\s+\(/i, // "at Function (file.ts:10:5)"
  /\.(ts|js|mjs|cjs):\d+:\d+/, // file.ts:10:5
  /node_modules\//,
  /\/src\//,
  /\\src\\/,
  /Error:\s+.*\n\s+at/s, // Multi-line stack trace
  /^\s+at\s+/m, // Line starting with "at"
]

// Build a minimal Fastify app that simulates the production error handler
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  // Replicate the production error handler from app.ts
  app.setErrorHandler((error, request, reply) => {
    const requestId = (request.headers['x-amzn-requestid'] as string) ?? request.id ?? ''

    if (error instanceof AppError) {
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

    const err = error as Error & {
      statusCode?: number
      validation?: unknown
      name?: string
    }

    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: 'bad_request',
        message: err.message ?? 'Invalid request',
        statusCode: err.statusCode,
        requestId,
      })
    }

    if (err.name === 'ZodError') {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid request data',
        statusCode: 400,
        requestId,
      })
    }

    if (err.validation) {
      return reply.status(400).send({
        error: 'validation_error',
        message: err.message ?? 'Validation failed',
        statusCode: 400,
        requestId,
      })
    }

    return reply.status(500).send({
      error: 'internal_error',
      message: 'Internal server error',
      statusCode: 500,
      requestId,
    })
  })

  // Route that throws AppError based on query params
  app.get('/test/app-error', async (request) => {
    const query = request.query as { statusCode?: string; errorCode?: string; message?: string }
    const statusCode = parseInt(query.statusCode ?? '400', 10)
    const errorCode = query.errorCode ?? 'test_error'
    const message = query.message ?? 'Test error message'
    throw new AppError(statusCode, errorCode, message)
  })

  // Route that throws a raw Error (simulates unhandled exception)
  app.get('/test/raw-error', async (request) => {
    const query = request.query as { message?: string }
    throw new Error(query.message ?? 'Something went wrong internally')
  })

  // Route that throws a generic object error with statusCode
  app.get('/test/status-error', async (request) => {
    const query = request.query as { statusCode?: string; message?: string }
    const err = new Error(query.message ?? 'Client error') as Error & { statusCode: number }
    err.statusCode = parseInt(query.statusCode ?? '422', 10)
    throw err
  })

  await app.ready()
  return app
}

describe('Property 22: Structured Error Response', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('AppError responses always contain required fields and never expose internals', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random HTTP error status codes
        fc.integer({ min: 400, max: 599 }),
        // Generate random error codes (snake_case identifiers)
        fc.stringMatching(/^[a-z][a-z0-9_]{2,30}$/),
        // Generate random human-readable messages
        fc.string({ minLength: 1, maxLength: 200 }),
        async (statusCode, errorCode, message) => {
          const response = await app.inject({
            method: 'GET',
            url: '/test/app-error',
            query: {
              statusCode: String(statusCode),
              errorCode,
              message,
            },
          })

          const body = JSON.parse(response.body)

          // SHALL contain required fields
          expect(body).toHaveProperty('error')
          expect(body).toHaveProperty('message')
          expect(body).toHaveProperty('statusCode')
          expect(typeof body.error).toBe('string')
          expect(typeof body.message).toBe('string')
          expect(typeof body.statusCode).toBe('number')

          // statusCode in body matches HTTP status
          expect(response.statusCode).toBe(statusCode)
          expect(body.statusCode).toBe(statusCode)

          // SHALL NOT contain stack traces or internal paths
          const bodyStr = JSON.stringify(body)
          for (const pattern of STACK_TRACE_PATTERNS) {
            expect(bodyStr).not.toMatch(pattern)
          }

          // SHALL NOT contain raw exception class names
          expect(body).not.toHaveProperty('stack')
          expect(body).not.toHaveProperty('type')
          expect(body).not.toHaveProperty('name')
        },
      ),
      { numRuns: 100 },
    )
  })

  it('raw Error responses always return structured format without stack traces', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random error messages that might contain sensitive info
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.constant('Error at /src/features/auth/service.ts:42:10'),
          fc.constant('Cannot read property of undefined\n    at Object.<anonymous>'),
          fc.constant('ECONNREFUSED 127.0.0.1:5432'),
          fc.constant('ValidationError: "email" must be a valid email'),
        ),
        async (errorMessage) => {
          const response = await app.inject({
            method: 'GET',
            url: '/test/raw-error',
            query: { message: errorMessage },
          })

          const body = JSON.parse(response.body)

          // SHALL contain required fields
          expect(body).toHaveProperty('error')
          expect(body).toHaveProperty('message')
          expect(body).toHaveProperty('statusCode')
          expect(typeof body.error).toBe('string')
          expect(typeof body.message).toBe('string')
          expect(typeof body.statusCode).toBe('number')

          // Raw errors always return 500
          expect(response.statusCode).toBe(500)
          expect(body.statusCode).toBe(500)

          // Message should be generic, not the raw error message
          expect(body.message).toBe('Internal server error')
          expect(body.error).toBe('internal_error')

          // SHALL NOT contain stack traces or internal paths
          const bodyStr = JSON.stringify(body)
          for (const pattern of STACK_TRACE_PATTERNS) {
            expect(bodyStr).not.toMatch(pattern)
          }

          // SHALL NOT expose the original error message
          expect(body).not.toHaveProperty('stack')
          expect(body).not.toHaveProperty('originalError')
          expect(body).not.toHaveProperty('cause')
        },
      ),
      { numRuns: 100 },
    )
  })

  it('status-coded errors return structured format without internals', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 400, max: 499 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (statusCode, message) => {
          const response = await app.inject({
            method: 'GET',
            url: '/test/status-error',
            query: {
              statusCode: String(statusCode),
              message,
            },
          })

          const body = JSON.parse(response.body)

          // SHALL contain required fields
          expect(body).toHaveProperty('error')
          expect(body).toHaveProperty('message')
          expect(body).toHaveProperty('statusCode')
          expect(typeof body.error).toBe('string')
          expect(typeof body.message).toBe('string')
          expect(typeof body.statusCode).toBe('number')

          // Status code matches
          expect(response.statusCode).toBe(statusCode)
          expect(body.statusCode).toBe(statusCode)

          // SHALL NOT contain stack traces or internal paths
          const bodyStr = JSON.stringify(body)
          for (const pattern of STACK_TRACE_PATTERNS) {
            expect(bodyStr).not.toMatch(pattern)
          }

          // SHALL NOT contain raw exception details
          expect(body).not.toHaveProperty('stack')
          expect(body).not.toHaveProperty('name')
          expect(body).not.toHaveProperty('type')
        },
      ),
      { numRuns: 100 },
    )
  })
})
