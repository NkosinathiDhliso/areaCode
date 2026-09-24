/**
 * `GET /v1/business/boosts/:boostId/scoreboard` — what one Boost_Window
 * recorded, next to the same clock window seven days earlier
 * (proof-of-demand R7.1, R7.2).
 *
 * **Validates: Requirements 7.1, 7.2**
 *
 * The route runs through its real preHandler chain (business auth, the
 * owner-only `manage_billing` check, Zod validation of `boostId`, then the
 * sliding-window rate limiter) and the real read, `computeBoostScoreboard` and
 * `computeReceipt`. Only DynamoDB, the KV store and the token verifier are
 * mocked, so what is covered is what the endpoint promises:
 *
 *   - a manager cannot read it and an unauthenticated caller reads nothing
 *   - an unknown boost id, and one belonging to another business, are the same
 *     404, so the endpoint cannot be used to discover real checkout ids
 *   - while the window is open every read computes live and nothing is stored
 *   - the first read after the window closes stores the result, later reads
 *     return the stored copy, and a stored scoreboard is never overwritten by a
 *     recomputation even when the underlying check-ins have changed
 */

import type { FastifyInstance } from 'fastify'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mutable mock state ──────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  interface RepoCheckIn {
    userId: string
    checkedInAt: string
    foundVia?: string
  }

  const state = {
    /** `BOOST_CHECKOUT#<id>` marker rows, by yocoCheckoutId. */
    markers: new Map<string, Record<string, unknown>>(),
    /** BoosterPurchase audit rows, by `${pk}|${sk}`. */
    purchases: new Map<string, Record<string, unknown>>(),
    checkIns: [] as RepoCheckIn[],
    kv: new Map<string, string>(),
    rateLimitCount: 1,
  }

  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    if (cmd.constructor.name === 'GetCommand') {
      const key = (cmd.input?.['Key'] ?? {}) as { pk: string; sk: string }
      if (key.pk.startsWith('BOOST_CHECKOUT#')) {
        const item = state.markers.get(key.pk.slice('BOOST_CHECKOUT#'.length))
        return item ? { Item: item } : {}
      }
      const purchase = state.purchases.get(`${key.pk}|${key.sk}`)
      return purchase ? { Item: purchase } : {}
    }
    return { Items: [] }
  })

  const getCheckInsByNodeMock = vi.fn(async () => ({ checkIns: state.checkIns }))
  const getBusinessByIdMock = vi.fn(async (id: string) => (id === 'biz-1' ? { businessId: 'biz-1' } : null))
  const getStaffByIdMock = vi.fn(async (id: string) =>
    id === 'mgr-1' ? { staffId: 'mgr-1', businessId: 'biz-1', role: 'manager' } : null,
  )

  const kvGetMock = vi.fn(async (key: string) => state.kv.get(key) ?? null)
  const kvSetMock = vi.fn(async (key: string, value: string) => {
    state.kv.set(key, value)
  })
  const kvIncrMock = vi.fn(async () => state.rateLimitCount)

  return {
    state,
    sendMock,
    getCheckInsByNodeMock,
    getBusinessByIdMock,
    getStaffByIdMock,
    kvGetMock,
    kvSetMock,
    kvIncrMock,
  }
})

// DEV_MODE off: the permission check and the production read must both run.
vi.mock('../../../shared/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/config/env.js')>()
  return { ...actual, DEV_MODE: false }
})

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.sendMock } }
})

vi.mock('../../../shared/kv/dynamodb-kv.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/kv/dynamodb-kv.js')>()
  return { ...actual, kvGet: h.kvGetMock, kvSet: h.kvSetMock, kvIncr: h.kvIncrMock, kvTtl: vi.fn(async () => 60) }
})

vi.mock('../../check-in/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../check-in/dynamodb-repository.js')>()
  return { ...actual, getCheckInsByNode: h.getCheckInsByNodeMock }
})

vi.mock('../../auth/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/dynamodb-repository.js')>()
  return { ...actual, getBusinessById: h.getBusinessByIdMock, getStaffById: h.getStaffByIdMock }
})

// Stand-in for the Cognito verifier: same contract (401 without a bearer token,
// `request.auth` on success) without reaching JWKS.
vi.mock('../../../shared/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/middleware/auth.js')>()
  const SESSIONS: Record<string, { userId: string; role: string; cognitoSub: string }> = {
    owner: { userId: 'biz-1', role: 'business', cognitoSub: 'sub-owner' },
    other: { userId: 'biz-2', role: 'business', cognitoSub: 'sub-other' },
    manager: { userId: 'mgr-1', role: 'staff', cognitoSub: 'sub-mgr' },
  }
  return {
    ...actual,
    requireAuth:
      (...roles: string[]) =>
      async (request: { headers?: Record<string, string>; auth?: unknown }) => {
        const header = request.headers?.['authorization']
        const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
        const session = SESSIONS[token]
        if (!session || !roles.includes(session.role)) {
          throw Object.assign(new Error('Invalid or expired token'), { statusCode: 401 })
        }
        request.auth = session
      },
  }
})

import type { BoostScoreboardView } from '@area-code/shared/types'

import { SUPPRESSION_FLOOR } from '../../reports/suppression.js'
import { boostScoreboardCacheKey } from '../boost-scoreboard-read.js'
import { boostScoreboardBaselineWindow } from '../boost-scoreboard.js'
import { businessRoutes } from '../handler.js'
import { boostWindowEnd } from '../types.js'

// ─── Harness ─────────────────────────────────────────────────────────────────

type Handler = (request: unknown, reply: unknown) => unknown | Promise<unknown>

interface CapturedRoute {
  url: string
  opts: { preHandler: Handler[] }
  handler: Handler
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

async function getRoute(): Promise<CapturedRoute> {
  const routes: CapturedRoute[] = []
  const collect = (url: string, opts: unknown, handler?: Handler) => {
    if (handler) routes.push({ url, opts: opts as { preHandler: Handler[] }, handler })
  }
  const app = {
    get: collect,
    post: collect,
    patch: collect,
    put: collect,
    delete: collect,
  } as unknown as FastifyInstance
  await businessRoutes(app)
  const route = routes.find((r) => r.url === '/v1/business/boosts/:boostId/scoreboard')
  if (!route) throw new Error('boost scoreboard route not registered')
  return route
}

/** Run the real preHandler chain, then the handler, as Fastify would. */
async function get(boostId: string, token: string | null = 'owner') {
  const route = await getRoute()
  const req = {
    params: { boostId },
    ip: '203.0.113.9',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  }
  const reply = { status: () => reply, send: () => reply }
  for (const pre of route.opts.preHandler) await pre(req, reply)
  return (await route.handler(req, reply)) as BoostScoreboardView
}

// ─── Fixture: one purchase, addressed the way the marker addresses it ─────────

const BOOST_ID = 'chk_boost_1'
const NODE_ID = 'node-a'

/** A closed 2hr window that ended a day ago. */
const CLOSED_PAID_AT = new Date(Date.now() - DAY_MS - 2 * HOUR_MS).toISOString()
/** An open 2hr window that started an hour ago. */
const OPEN_PAID_AT = new Date(Date.now() - HOUR_MS).toISOString()

function seedPurchase(paidAt: string, businessId = 'biz-1', boostId = BOOST_ID): { pk: string; sk: string } {
  const pk = `BOOST#${businessId}`
  const sk = `BOOST#${paidAt}#${boostId}`
  h.state.markers.set(boostId, {
    pk: `BOOST_CHECKOUT#${boostId}`,
    sk: `BOOST_CHECKOUT#${boostId}`,
    businessId,
    boostPk: pk,
    boostSk: sk,
    createdAt: paidAt,
  })
  h.state.purchases.set(`${pk}|${sk}`, {
    pk,
    sk,
    gsi1pk: 'BOOST_BY_TIME',
    gsi1sk: `${paidAt}#${boostId}`,
    businessId,
    nodeId: NODE_ID,
    duration: '2hr',
    amountCents: 2500,
    currency: 'ZAR',
    yocoCheckoutId: boostId,
    paidAt,
    tierSnapshot: 'growth',
    neighbourhoodIdSnapshot: null,
    floorAtPurchaseCents: 2000,
    createdAt: paidAt,
  })
  return { pk, sk }
}

/** `count` distinct consumers inside `window`, Found_You unless told otherwise. */
function visitors(window: { windowStartUtc: string }, count: number, prefix: string, foundVia?: string) {
  const startMs = new Date(window.windowStartUtc).getTime()
  return Array.from({ length: count }, (_, i) => ({
    userId: `${prefix}-${i}`,
    checkedInAt: new Date(startMs + i * 60_000).toISOString(),
    ...(foundVia === undefined ? {} : { foundVia }),
  }))
}

function windowFor(paidAt: string) {
  return { windowStartUtc: paidAt, windowEndUtc: boostWindowEnd(paidAt, '2hr') }
}

beforeEach(() => {
  h.state.markers.clear()
  h.state.purchases.clear()
  h.state.kv.clear()
  h.state.checkIns = []
  h.state.rateLimitCount = 1
  h.sendMock.mockClear()
  h.getCheckInsByNodeMock.mockClear()
  h.kvGetMock.mockClear()
  h.kvSetMock.mockClear()
})

// ─── Auth and permission (owner only) ────────────────────────────────────────

describe('GET /v1/business/boosts/:boostId/scoreboard — who may read it (R7.2)', () => {
  beforeEach(() => {
    seedPurchase(CLOSED_PAID_AT)
  })

  it('reads nothing for an unauthenticated caller', async () => {
    await expect(get(BOOST_ID, null)).rejects.toMatchObject({ statusCode: 401 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('refuses a manager: a boost is a billing decision', async () => {
    await expect(get(BOOST_ID, 'manager')).rejects.toMatchObject({ statusCode: 403 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('serves the owner', async () => {
    const body = await get(BOOST_ID)

    expect(body.boostId).toBe(BOOST_ID)
    expect(body.nodeId).toBe(NODE_ID)
  })

  it('rate limits the read with the shared sliding window', async () => {
    h.state.rateLimitCount = 10_000

    await expect(get(BOOST_ID)).rejects.toMatchObject({ statusCode: 429 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })
})

// ─── Validation and ownership ────────────────────────────────────────────────

describe('GET /v1/business/boosts/:boostId/scoreboard — which purchase (R7.1)', () => {
  it('rejects a boost id that could never key a purchase, before any read', async () => {
    await expect(get('not a/valid#id')).rejects.toMatchObject({ statusCode: 400 })
    expect(h.sendMock).not.toHaveBeenCalled()
  })

  it('404s an unknown boost id', async () => {
    await expect(get('chk_never_existed')).rejects.toMatchObject({ statusCode: 404 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('404s a purchase owned by another business, identically to an unknown one', async () => {
    seedPurchase(CLOSED_PAID_AT, 'biz-2', 'chk_someone_else')

    const mine = get('chk_never_existed').catch((err) => err as { statusCode: number; message: string })
    const theirs = get('chk_someone_else').catch((err) => err as { statusCode: number; message: string })

    const [unknown, foreign] = await Promise.all([mine, theirs])
    expect(foreign.statusCode).toBe(404)
    expect(foreign.message).toBe(unknown.message)
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('404s a marker whose audit row is missing rather than reporting an empty window', async () => {
    const { pk, sk } = seedPurchase(CLOSED_PAID_AT)
    h.state.purchases.delete(`${pk}|${sk}`)

    await expect(get(BOOST_ID)).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─── The two windows ─────────────────────────────────────────────────────────

describe('GET /v1/business/boosts/:boostId/scoreboard — the counts (R7.1)', () => {
  it('reports the Boost_Window and the same clock window seven days earlier', async () => {
    seedPurchase(CLOSED_PAID_AT)
    const boostWindow = windowFor(CLOSED_PAID_AT)
    const baseline = boostScoreboardBaselineWindow(boostWindow)

    h.state.checkIns = [
      ...visitors(boostWindow, SUPPRESSION_FLOOR + 2, 'now', 'map'),
      ...visitors(baseline, SUPPRESSION_FLOOR, 'then'),
    ]

    const body = await get(BOOST_ID)

    expect(body.window).toMatchObject({
      windowStartUtc: CLOSED_PAID_AT,
      windowEndUtc: boostWindow.windowEndUtc,
      checkIns: SUPPRESSION_FLOOR + 2,
      foundYou: SUPPRESSION_FLOOR + 2,
      walkIns: 0,
    })
    expect(body.baseline).toMatchObject({
      windowStartUtc: baseline.windowStartUtc,
      windowEndUtc: baseline.windowEndUtc,
      checkIns: SUPPRESSION_FLOOR,
      foundYou: 0,
      walkIns: SUPPRESSION_FLOOR,
    })
    expect(body.comparable).toBe(true)
    expect(body.delta).toEqual({
      checkIns: 2,
      visitors: 2,
      foundYou: SUPPRESSION_FLOOR + 2,
      walkIns: -SUPPRESSION_FLOOR,
    })
  })

  it('withholds the comparison below the Suppression_Floor and still reports both sets of counts', async () => {
    seedPurchase(CLOSED_PAID_AT)
    const boostWindow = windowFor(CLOSED_PAID_AT)

    h.state.checkIns = visitors(boostWindow, SUPPRESSION_FLOOR - 1, 'now', 'map')

    const body = await get(BOOST_ID)

    expect(body.window.checkIns).toBe(SUPPRESSION_FLOOR - 1)
    expect(body.baseline.checkIns).toBe(0)
    expect(body.comparable).toBe(false)
    expect(body.delta).toBeNull()
  })

  it('reads the boosted node once, over a range reaching back to the baseline start', async () => {
    seedPurchase(CLOSED_PAID_AT)
    const baselineStart = boostScoreboardBaselineWindow(windowFor(CLOSED_PAID_AT)).windowStartUtc

    await get(BOOST_ID)

    expect(h.getCheckInsByNodeMock).toHaveBeenCalledTimes(1)
    const [nodeId, options] = h.getCheckInsByNodeMock.mock.calls[0] as unknown as [string, { hours: number }]
    expect(nodeId).toBe(NODE_ID)
    // The range must cover the baseline start; anything shorter would report a
    // baseline of zero for a week that had visitors.
    const coveredFrom = Date.now() - options.hours * HOUR_MS
    expect(coveredFrom).toBeLessThanOrEqual(Date.parse(baselineStart))
  })
})

// ─── Open window: live, uncached ─────────────────────────────────────────────

describe('GET /v1/business/boosts/:boostId/scoreboard — an open window computes live (R7.2)', () => {
  beforeEach(() => {
    seedPurchase(OPEN_PAID_AT)
  })

  it('stores nothing while the window can still change', async () => {
    h.state.checkIns = visitors(windowFor(OPEN_PAID_AT), 2, 'now', 'map')

    const body = await get(BOOST_ID)

    expect(body.windowClosed).toBe(false)
    expect(body.window.foundYou).toBe(2)
    expect(h.kvSetMock).not.toHaveBeenCalled()
    expect(h.state.kv.size).toBe(0)
  })

  it('recomputes on every read, so a check-in mid-window shows up', async () => {
    const boostWindow = windowFor(OPEN_PAID_AT)
    h.state.checkIns = visitors(boostWindow, 1, 'now', 'map')
    expect((await get(BOOST_ID)).window.foundYou).toBe(1)

    h.state.checkIns = visitors(boostWindow, 3, 'now', 'map')
    expect((await get(BOOST_ID)).window.foundYou).toBe(3)

    expect(h.getCheckInsByNodeMock).toHaveBeenCalledTimes(2)
  })
})

// ─── Closed window: cached once, never recomputed ────────────────────────────

describe('GET /v1/business/boosts/:boostId/scoreboard — a closed window is history (R7.2)', () => {
  let keys: { pk: string; sk: string }

  beforeEach(() => {
    keys = seedPurchase(CLOSED_PAID_AT)
    h.state.checkIns = visitors(windowFor(CLOSED_PAID_AT), 4, 'now', 'map')
  })

  it('stores the scoreboard on the first read after the window closes', async () => {
    const body = await get(BOOST_ID)

    expect(body.windowClosed).toBe(true)
    expect(h.kvSetMock).toHaveBeenCalledTimes(1)

    const [key, value, ttl] = h.kvSetMock.mock.calls[0] as unknown as [string, string, number | undefined]
    expect(key).toBe(boostScoreboardCacheKey(keys.pk, keys.sk))
    // No TTL: this is the owner's record of a window they paid for.
    expect(ttl).toBeUndefined()
    expect(JSON.parse(value)).toMatchObject({ window: { foundYou: 4 } })
  })

  it('serves the stored copy on the second read, without touching check-ins again', async () => {
    const first = await get(BOOST_ID)
    h.getCheckInsByNodeMock.mockClear()

    const second = await get(BOOST_ID)

    expect(second).toEqual(first)
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('never overwrites a stored scoreboard, even when the check-ins behind it change', async () => {
    const first = await get(BOOST_ID)
    expect(first.window.foundYou).toBe(4)

    // Rows disappear (erasure, retention) or arrive late: history must not move.
    h.state.checkIns = []
    const second = await get(BOOST_ID)

    expect(second.window.foundYou).toBe(4)
    expect(h.kvSetMock).toHaveBeenCalledTimes(1)
    expect(h.state.kv.size).toBe(1)
  })

  it('surfaces an unreadable stored scoreboard instead of quietly recomputing it', async () => {
    h.state.kv.set(boostScoreboardCacheKey(keys.pk, keys.sk), '{"window":{"foundYou":"four"}}')

    await expect(get(BOOST_ID)).rejects.toMatchObject({ statusCode: 500 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
    expect(h.kvSetMock).not.toHaveBeenCalled()
  })
})
