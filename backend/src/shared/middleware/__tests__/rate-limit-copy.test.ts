/**
 * `429` copy per limiter, and the demo-day limits (R15.9, decision 9).
 *
 * **Validates: Requirements 15.9**
 *
 * A throttled read used to answer "Too many requests", which on a venue sheet is
 * indistinguishable from a broken screen. Each limiter now names its own surface,
 * and the numbers themselves are hard-coded constants at the route: a UAT-only
 * env override would be a second source of truth for the same limit
 * (`no-fallbacks-no-legacy.md`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  kvIncr: vi.fn(),
  kvTtl: vi.fn(),
}))

vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>()
  // The limiter is a no-op in DEV_MODE, so the live path has to be forced here.
  return { ...actual, DEV_MODE: false }
})

vi.mock('../../kv/dynamodb-kv.js', () => ({ kvIncr: h.kvIncr, kvTtl: h.kvTtl }))

import { CHECK_IN_ROUTE_RATE_LIMIT } from '../../../features/check-in/rate-limits.js'
import { WHO_IS_HERE_RATE_LIMIT } from '../../../features/nodes/rate-limits.js'
import { rateLimitMiddleware } from '../rate-limit.js'

const request = { ip: '10.0.0.1' } as Parameters<ReturnType<typeof rateLimitMiddleware>>[0]

/** Run a limiter with the budget already spent and `waitSeconds` left. */
async function throttled(options: Parameters<typeof rateLimitMiddleware>[0], waitSeconds: number) {
  h.kvIncr.mockResolvedValue(options.max + 1)
  h.kvTtl.mockResolvedValue(waitSeconds)
  return rateLimitMiddleware(options)(request).then(
    () => null,
    (err: unknown) => err as { statusCode: number; message: string; cooldownUntil?: string },
  )
}

beforeEach(() => {
  h.kvIncr.mockReset()
  h.kvTtl.mockReset()
})

describe('demo-day limits (decision 9)', () => {
  it("raises who's-here to 60 per 600s in every environment", () => {
    expect(WHO_IS_HERE_RATE_LIMIT.max).toBe(60)
    expect(WHO_IS_HERE_RATE_LIMIT.windowSeconds).toBe(600)
  })

  it('keeps the check-in route at 10 per 60s', () => {
    expect(CHECK_IN_ROUTE_RATE_LIMIT.max).toBe(10)
    expect(CHECK_IN_ROUTE_RATE_LIMIT.windowSeconds).toBe(60)
  })
})

describe('429 copy per limiter (R15.9)', () => {
  it("answers who's-here with its own copy", async () => {
    const err = await throttled(WHO_IS_HERE_RATE_LIMIT, 120)

    expect(err?.statusCode).toBe(429)
    expect(err?.message).toBe('Slow down a moment, then tap to see who is here.')
  })

  it('answers the check-in route with the wait in seconds', async () => {
    const err = await throttled(CHECK_IN_ROUTE_RATE_LIMIT, 42)

    expect(err?.statusCode).toBe(429)
    expect(err?.message).toBe('Too many check-in attempts, wait 42 seconds.')
  })

  it('carries the retry instant alongside the copy so a client can time its retry', async () => {
    const err = (await throttled(CHECK_IN_ROUTE_RATE_LIMIT, 30)) as { cooldownUntil?: string } | null

    expect(typeof err?.cooldownUntil).toBe('string')
    expect(Date.parse(err!.cooldownUntil!)).toBeGreaterThan(Date.now())
  })

  it('falls back to the generic sentence for a limiter with no copy of its own', async () => {
    const err = await throttled({ key: 'trending', max: 30, windowSeconds: 60 }, 15)

    expect(err?.message).toBe('Too many requests. Try again in 15s.')
  })

  it('lets a request through while the budget is unspent', async () => {
    h.kvIncr.mockResolvedValue(1)

    await expect(rateLimitMiddleware(WHO_IS_HERE_RATE_LIMIT)(request)).resolves.toBeUndefined()
    expect(h.kvTtl).not.toHaveBeenCalled()
  })
})
