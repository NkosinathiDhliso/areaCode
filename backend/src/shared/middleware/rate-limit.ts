import type { FastifyRequest } from 'fastify'

import { DEV_MODE } from '../config/env.js'
import { AppError } from '../errors/AppError.js'
import { kvIncr, kvTtl } from '../kv/dynamodb-kv.js'

interface RateLimitOptions {
  /** Key prefix for this limiter */
  key: string
  /** Max requests in the window */
  max: number
  /** Window in seconds */
  windowSeconds: number
  /**
   * Copy for this limiter's `429`, as a function of the seconds left in the
   * window (proof-of-demand R15.9).
   *
   * A throttled read must not read as a broken screen, and "Too many requests"
   * on a venue sheet tells a consumer nothing about what they did or what to do.
   * Each limiter names its own surface, so the generic sentence below is only
   * ever a limiter nobody has written copy for yet.
   */
  message?: (waitSeconds: number) => string
  /** Function to extract identifier (defaults to IP) */
  identifierFn?: (request: FastifyRequest) => string
}

/**
 * DynamoDB-TTL-backed sliding window rate limiter.
 * Returns a Fastify preHandler.
 */
export function rateLimitMiddleware(options: RateLimitOptions) {
  const { key, max, windowSeconds, message, identifierFn } = options

  return async (request: FastifyRequest) => {
    if (DEV_MODE) return // Skip rate limiting in dev mode

    const identifier = identifierFn ? identifierFn(request) : request.ip

    const kvKey = `ratelimit:${key}:${identifier}`
    const current = await kvIncr(kvKey, windowSeconds)

    if (current > max) {
      const ttl = await kvTtl(kvKey)
      const waitSeconds = ttl > 0 ? ttl : windowSeconds
      const retryAt = new Date(Date.now() + waitSeconds * 1000).toISOString()
      const copy = message ? message(waitSeconds) : `Too many requests. Try again in ${waitSeconds}s.`
      throw AppError.tooManyRequests(copy, retryAt)
    }
  }
}
