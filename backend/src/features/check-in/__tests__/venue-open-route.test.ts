/**
 * `POST /v1/nodes/:nodeId/open` — the Venue_Open write
 * (proof-of-demand R2.1, R2.3, R2.4, R2.5, R11.1).
 *
 * The route is exercised through its real preHandler chain (consumer auth, then
 * Zod validation, then the sliding-window rate limiter) and the real
 * `recordVenueOpen` service, with only the KV store, the check-in service and the
 * auth verifier mocked. So these tests cover what the endpoint actually promises
 * an owner and a consumer:
 *
 *  - it answers 204 with no body: the consumer app never reads its own opens back
 *  - the stored row is `{ source, openedAt, away }` and nothing else, with a TTL
 *    of exactly the Attribution_Window, so no sweeper is needed (R2.4, R11.1)
 *  - a repeat open merges rather than overwrites: the earliest open keeps the
 *    credit, an earlier away open is never discarded, and the window is never
 *    shortened (R2.3)
 *  - coordinates cannot be stored even when a client sends them
 *  - an unauthenticated caller and a caller over budget both write nothing
 *  - `walk_in` is rejected as a source: it is an outcome, never a claim
 *
 * _Requirements: 2.1, 2.3, 2.4, 2.5, 11.1_
 */

import { ATTRIBUTION_WINDOW_HOURS } from '@area-code/shared/constants/attribution'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  kvGet: vi.fn(async (_key: string): Promise<string | null> => null),
  kvSet: vi.fn(async (_key: string, _value: string, _ttlSeconds?: number) => undefined),
  kvDel: vi.fn(async (_key: string) => undefined),
  kvIncr: vi.fn(async (_key: string, _ttlSeconds?: number) => 1),
  kvTtl: vi.fn(async (_key: string) => 60),
  authRoles: [] as string[][],
  userId: 'user-nomsa',
}))

// DEV_MODE off, so the rate limiter really runs rather than short-circuiting.
vi.mock('../../../shared/config/env.js', () => ({
  DEV_MODE: false,
  APP_ENV: 'test',
  IS_PROD: false,
  AWS_REGION: 'af-south-1',
  requireEnv: (_name: string, devDefault?: string) => devDefault ?? 'test-value',
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: h.kvGet,
  kvSet: h.kvSet,
  kvDel: h.kvDel,
  kvIncr: h.kvIncr,
  kvTtl: h.kvTtl,
}))

// The check-in pipeline is not under test here; the handler only needs the module
// to exist so the other route on it can register.
vi.mock('../service.js', () => ({ processCheckIn: vi.fn() }))

// Stand-in for the Cognito verifier: same contract (401 without a bearer token,
// `request.auth` on success) without reaching a JWKS endpoint. The roles the
// route asks for are recorded so the test can assert it is consumer-only.
vi.mock('../../../shared/middleware/auth.js', () => ({
  requireAuth: (...roles: string[]) => {
    h.authRoles.push(roles)
    return async (request: { headers?: Record<string, string>; auth?: unknown }) => {
      const header = request.headers?.['authorization']
      if (!header?.startsWith('Bearer ')) {
        throw Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 })
      }
      request.auth = { userId: h.userId, role: 'consumer' }
    }
  },
  getAuth: (request: { auth?: { userId: string } }) => request.auth,
}))

import type { FastifyInstance } from 'fastify'

import { checkInRoutes } from '../handler.js'
import { VENUE_OPEN_RATE_LIMIT } from '../rate-limits.js'
import { ATTRIBUTION_WINDOW_SECONDS, venueOpenKey } from '../venue-open.js'

// ─── Harness ────────────────────────────────────────────────────────────────

type Handler = (request: unknown, reply: unknown) => unknown | Promise<unknown>

interface CapturedRoute {
  url: string
  opts: { preHandler: Handler[] }
  handler: Handler
}

const NODE_ID = 'node-ramonas'
const OPEN_KEY = venueOpenKey('user-nomsa', NODE_ID)
const IP = '203.0.113.9'

async function getRoute(): Promise<CapturedRoute> {
  const routes: CapturedRoute[] = []
  const app = {
    post: (url: string, opts: { preHandler: Handler[] }, handler: Handler) => {
      routes.push({ url, opts, handler })
    },
  } as unknown as FastifyInstance
  await checkInRoutes(app)
  const route = routes.find((r) => r.url === '/v1/nodes/:nodeId/open')
  if (!route) throw new Error('venue-open route not registered')
  return route
}

function makeReply() {
  const state: { statusCode?: number; body?: unknown } = {}
  const reply = {
    status(code: number) {
      state.statusCode = code
      return reply
    },
    send(body?: unknown) {
      state.body = body
      return reply
    },
  }
  return { reply, state }
}

/** Run the real preHandler chain, then the handler, as Fastify would. */
async function post(body: unknown, opts: { authenticated?: boolean } = {}) {
  const route = await getRoute()
  const { reply, state } = makeReply()
  const req = {
    params: { nodeId: NODE_ID },
    body,
    ip: IP,
    headers: opts.authenticated === false ? {} : { authorization: 'Bearer token' },
  }
  for (const pre of route.opts.preHandler) await pre(req, reply)
  await route.handler(req, reply)
  return state
}

/** The row this call persisted, parsed back out of the KV write. */
function writtenRow(): { source: string; openedAt: string; away: boolean | null } {
  const call = h.kvSet.mock.calls.find((c) => c[0] === OPEN_KEY)
  if (!call) throw new Error('no Venue_Open row was written')
  return JSON.parse(String(call[1]))
}

function writtenTtl(): number {
  const call = h.kvSet.mock.calls.find((c) => c[0] === OPEN_KEY)
  return Number(call?.[2])
}

beforeEach(() => {
  h.kvGet.mockReset().mockResolvedValue(null)
  h.kvSet.mockReset().mockResolvedValue(undefined)
  h.kvDel.mockReset().mockResolvedValue(undefined)
  h.kvIncr.mockReset().mockResolvedValue(1)
  h.kvTtl.mockReset().mockResolvedValue(60)
  h.authRoles.length = 0
})

// ─── Response and stored row ────────────────────────────────────────────────

describe('POST /v1/nodes/:nodeId/open — the row (R2.1, R2.4, R11.1)', () => {
  it('answers 204 with no body', async () => {
    const res = await post({ source: 'map', away: true })

    expect(res.statusCode).toBe(204)
    expect(res.body).toBeUndefined()
  })

  it('stores the source, the open instant and away under the consumer-and-venue key', async () => {
    const before = Date.now()

    await post({ source: 'share', away: false })

    const row = writtenRow()
    expect(row.source).toBe('share')
    expect(row.away).toBe(false)
    expect(Date.parse(row.openedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(row.openedAt)).toBeLessThanOrEqual(Date.now())
  })

  it('stores away as null when the client had no fresh position', async () => {
    await post({ source: 'map', away: null })

    expect(writtenRow().away).toBeNull()
  })

  it('expires the row after exactly the Attribution_Window, so nothing sweeps it', async () => {
    await post({ source: 'map', away: null })

    expect(writtenTtl()).toBe(ATTRIBUTION_WINDOW_HOURS * 60 * 60)
    expect(writtenTtl()).toBe(ATTRIBUTION_WINDOW_SECONDS)
  })

  it('stores three fields only: no coordinates, no device data, even when sent', async () => {
    await post({ source: 'map', away: true, lat: -26.2041, lng: 28.0473, deviceId: 'abc' })

    const row = writtenRow()
    expect(Object.keys(row).sort()).toEqual(['away', 'openedAt', 'source'])
    expect(JSON.stringify(row)).not.toContain('26.2')
    expect(JSON.stringify(row)).not.toContain('deviceId')
  })
})

// ─── Merge (earliest wins) ──────────────────────────────────────────────────

describe('POST /v1/nodes/:nodeId/open — repeat opens merge (R2.3)', () => {
  // Two hours ago: genuinely earlier than the open this request records.
  const earlier = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  it('keeps the earliest open and its source when a row already exists', async () => {
    h.kvGet.mockImplementation(async (key: string) =>
      key === OPEN_KEY ? JSON.stringify({ source: 'share', openedAt: earlier, away: null }) : null,
    )

    await post({ source: 'map', away: null })

    const row = writtenRow()
    expect(row.openedAt).toBe(earlier)
    expect(row.source).toBe('share')
  })

  it('never discards an earlier away open', async () => {
    h.kvGet.mockImplementation(async (key: string) =>
      key === OPEN_KEY ? JSON.stringify({ source: 'share', openedAt: earlier, away: true }) : null,
    )

    await post({ source: 'map', away: false })

    expect(writtenRow().away).toBe(true)
  })

  it('takes an away open that arrives second', async () => {
    h.kvGet.mockImplementation(async (key: string) =>
      key === OPEN_KEY ? JSON.stringify({ source: 'map', openedAt: earlier, away: false }) : null,
    )

    await post({ source: 'map', away: true })

    expect(writtenRow().away).toBe(true)
  })

  it('resets the TTL, so a second look never shortens the window', async () => {
    h.kvGet.mockImplementation(async (key: string) =>
      key === OPEN_KEY ? JSON.stringify({ source: 'map', openedAt: earlier, away: null }) : null,
    )

    await post({ source: 'map', away: null })

    expect(writtenTtl()).toBe(ATTRIBUTION_WINDOW_SECONDS)
  })

  it('reads an unreadable stored row as no open rather than trusting it', async () => {
    h.kvGet.mockImplementation(async (key: string) => (key === OPEN_KEY ? 'not json at all' : null))

    await post({ source: 'push', away: true })

    expect(writtenRow().source).toBe('push')
  })
})

// ─── Boundaries ─────────────────────────────────────────────────────────────

describe('POST /v1/nodes/:nodeId/open — boundaries (R2.1, R2.5)', () => {
  it('requires a consumer session', async () => {
    await getRoute()

    expect(h.authRoles.some((roles) => roles.length === 1 && roles[0] === 'consumer')).toBe(true)
  })

  it('writes nothing for an unauthenticated caller', async () => {
    await expect(post({ source: 'map', away: null }, { authenticated: false })).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(h.kvSet).not.toHaveBeenCalled()
  })

  it('rejects a source outside the Open_Sources', async () => {
    await expect(post({ source: 'billboard', away: null })).rejects.toMatchObject({ statusCode: 400 })
    expect(h.kvSet).not.toHaveBeenCalled()
  })

  it('rejects walk_in as a source: it is an outcome, never a claim', async () => {
    await expect(post({ source: 'walk_in', away: null })).rejects.toMatchObject({ statusCode: 400 })
    expect(h.kvSet).not.toHaveBeenCalled()
  })

  it('requires away to be stated, even as unknown', async () => {
    await expect(post({ source: 'map' })).rejects.toMatchObject({ statusCode: 400 })
    expect(h.kvSet).not.toHaveBeenCalled()
  })

  it('rate limits on the venue-open key with the shared sliding window', async () => {
    await post({ source: 'map', away: null })

    expect(h.kvIncr).toHaveBeenCalledWith(
      `ratelimit:${VENUE_OPEN_RATE_LIMIT.key}:${IP}`,
      VENUE_OPEN_RATE_LIMIT.windowSeconds,
    )
  })

  it('writes nothing once the budget is spent', async () => {
    h.kvIncr.mockResolvedValue(VENUE_OPEN_RATE_LIMIT.max + 1)

    await expect(post({ source: 'map', away: null })).rejects.toMatchObject({ statusCode: 429 })
    expect(h.kvSet).not.toHaveBeenCalled()
  })
})
