import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../redis/client.js';
import { rateLimit as rateLimitKey } from '../redis/keys.js';
import { AppError } from '../errors/AppError.js';
import { isDbAvailable } from '../db/prisma.js';

const DEV_MODE = !isDbAvailable;

interface RateLimitOptions {
  /** Key prefix for this limiter */
  key: string;
  /** Max requests in the window */
  max: number;
  /** Window in seconds */
  windowSeconds: number;
  /** Function to extract identifier (defaults to IP) */
  identifierFn?: (request: FastifyRequest) => string;
}

/**
 * Redis-backed sliding window rate limiter.
 * Returns a Fastify preHandler.
 */
export function rateLimitMiddleware(options: RateLimitOptions) {
  const { key, max, windowSeconds, identifierFn } = options;

  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (DEV_MODE) return; // Skip rate limiting in dev mode

    const identifier = identifierFn
      ? identifierFn(request)
      : request.ip;

    const redisKey = rateLimitKey(key, identifier);
    const current = await redis.incr(redisKey);

    if (current === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    if (current > max) {
      const ttl = await redis.ttl(redisKey);
      throw AppError.tooManyRequests(
        `Rate limit exceeded. Try again in ${ttl}s.`
      );
    }
  };
}
