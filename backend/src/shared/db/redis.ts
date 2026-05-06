// Redis singleton for Lambda reuse across warm invocations.
// Connection is lazy: if REDIS_URL is not set, getRedis() returns null and
// callers should fall back to DynamoDB. This keeps local dev + tests working
// without a Redis instance.
import IORedis, { type Redis } from 'ioredis'

let client: Redis | null = null
let initialized = false

export function getRedis(): Redis | null {
  if (initialized) return client
  initialized = true

  const url = process.env['REDIS_URL']
  if (!url) {
    console.warn('[redis] REDIS_URL not set — Redis-backed features disabled, falling back to DynamoDB')
    return null
  }

  client = new IORedis(url, {
    // Lambda-safe: keep connection alive across warm invocations, fail fast on cold.
    maxRetriesPerRequest: 2,
    connectTimeout: 2_000,
    enableAutoPipelining: true,
    lazyConnect: false,
    // TLS auto-detected from rediss:// scheme by ioredis.
  })

  client.on('error', (err) => {
    console.error('[redis] error:', err.message)
  })

  return client
}

/** Graceful shutdown for long-running processes (not Lambda). */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {})
    client = null
    initialized = false
  }
}
