import type { FastifyRequest } from 'fastify'
import { kvIncr, kvTtl } from '../kv/dynamodb-kv.js'
import { AppError } from '../errors/AppError.js'
import { DEV_MODE } from '../config/env.js'

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

  return async (request: FastifyRequest) => {
    if (DEV_MODE) return // Skip rate limiting in dev mode

    const identifier = identifierFn ? identifierFn(request) : request.ip

    const kvKey = `ratelimit:${key}:${identifier}`
    const current = await kvIncr(kvKey, windowSeconds)

    if (current > max) {
      const ttl = await kvTtl(kvKey)
      const waitSeconds = ttl > 0 ? ttl : windowSeconds
      const retryAt = new Date(Date.now() + waitSeconds * 1000).toISOString()
      throw AppError.tooManyRequests(`Too many requests. Try again in ${waitSeconds}s.`, retryAt)
    }
  }
}
