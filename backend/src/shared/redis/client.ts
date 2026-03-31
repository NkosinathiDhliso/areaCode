import Redis from 'ioredis'

/**
 * Redis client singleton.
 * If Redis is unavailable, features degrade gracefully — nodes render dormant.
 */

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

function createRedisClient(): Redis {
  const url = process.env['AREA_CODE_REDIS_URL']
  if (!url) {
    console.warn('[redis] AREA_CODE_REDIS_URL not set, using localhost')
  }

  const client = new Redis(url ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000)
      return delay
    },
    lazyConnect: true,
  })

  client.on('error', (err) => {
    console.error('[redis] Connection error:', err.message)
  })

  client.on('connect', () => {
    console.log('[redis] Connected')
  })

  return client
}

export const redis: Redis =
  globalForRedis.redis ?? createRedisClient()

if (process.env['AREA_CODE_ENV'] !== 'prod') {
  globalForRedis.redis = redis
}

export type { Redis }
