import type { FastifyRequest, FastifyReply } from 'fastify'
import { kvIncr, kvTtl } from '../kv/dynamodb-kv.js'
import { AppError } from '../errors/AppError.js'

interface RateLimitOptions {
  /** Key prefix for this limiter */
  key: string
  /** Max requests in the window */
  max: number
  /** Window in seconds */
  windowSeconds: number
  /** Function to extract identifier (defaults to IP) */
  identifierFn?: (request: FastifyRequest) => string
}

/**
 * DynamoDB-TTL-backed sliding window rate limiter.
 * Returns a Fastify preHandler.
 */
export function rateLimitMiddleware(options: RateLimitOptions) {
  const { key, max, windowSeconds, identifierFn } = options

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const identifier = identifierFn ? identifierFn(request) : request.ip

    const kvKey = `ratelimit:${key}:${identifier}`
    const current = await kvIncr(kvKey, windowSeconds)

    if (current > max) {
      const ttl = await kvTtl(kvKey)
      const retryAfter = ttl > 0 ? ttl : windowSeconds
      reply.header('Retry-After', String(retryAfter))
      throw AppError.tooManyRequests(`Rate limit exceeded. Try again in ${retryAfter}s.`)
    }
  }
}

/**
 * Global rate limiter applied to all public API endpoints.
 * Provides a generous baseline (100 requests per 60s per IP).
 * Per-route limiters can impose stricter limits on top of this.
 */
export function globalRateLimitHook() {
  const key = 'global'
  const max = 100
  const windowSeconds = 60

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip rate limiting for health checks
    if (request.url === '/health') return

    const identifier = request.ip
    const kvKey = `ratelimit:${key}:${identifier}`
    const current = await kvIncr(kvKey, windowSeconds)

    if (current > max) {
      const ttl = await kvTtl(kvKey)
      const retryAfter = ttl > 0 ? ttl : windowSeconds
      reply.header('Retry-After', String(retryAfter))
      throw AppError.tooManyRequests(`Rate limit exceeded. Try again in ${retryAfter}s.`)
    }
  }
}
