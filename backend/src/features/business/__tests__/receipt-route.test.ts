/**
 * `GET /v1/business/receipt?window=trial|paid|week` — the Receipt behind the
 * Plans panel upgrade CTA (proof-of-demand R6.1, R6.2, R6.3).
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * The route runs through its real preHandler chain (business auth, the
 * owner-only `manage_billing` check, Zod validation of `window`, then the
 * sliding-window rate limiter) and the real service, resolver, repository read,
 * `computeReceipt` and `buildReceiptCopy`. Only DynamoDB, the KV store and the
 * token verifier are mocked, so what is covered is what the endpoint promises:
 *
 *   - a manager cannot read the renewal numbers, and an unauthenticated caller
 *     reads nothing at all
 *   - `window` is one of exactly three values; anything else is 400 before any
 *     read happens, including `today`, which is a copy label but not a window
 *     this endpoint reports
 *   - each window resolves from the subscription, server-side: the trial from
 *     `trialEndsAt - TRIAL_DAYS`, the paid period from the payment that bought
 *     it, the week from `digestWeekFor`
 *   - the response carries the split counts and the sentences from
 *     `buildReceiptCopy`, with the zero branch pointing at the checklist step
 *     that is actually missing instead of reporting a zero
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
    business: {} as Record<string, unknown>,
    payments: [] as Array<{ paidAt: string }>,
    checkIns: [] as RepoCheckIn[],
    rewards: [] as unknown[],
    staff: [] as unknown[],
    rateLimitCount: 1,
  }

  // The nodes read (BusinessIndex) is the only DynamoDB call the receipt path
  // makes directly; the SUB# payment query goes through the repository helper,
  // which this mock also serves.
  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    if (cmd.constructor.name === 'QueryCommand' && cmd.input?.['IndexName'] === 'BusinessIndex') {
      return { Items: [{ nodeId: 'node-a', cityId: 'city-1', qrCheckinEnabled: true }] }
    }
    if (cmd.constructor.name === 'QueryCommand' && String(cmd.input?.['KeyConditionExpression']) === 'pk = :pk') {
      return { Items: [] }
    }
    return { Items: [] }
  })

  const getCheckInsByNodeMock = vi.fn(async () => ({ checkIns: state.checkIns }))
  const querySubscriptionPaymentsMock = vi.fn(async () => ({ items: state.payments, nextCursor: null }))
  const getBusinessByIdMock = vi.fn(async (id: string) => (id === 'biz-1' ? state.business : null))
  const getStaffByIdMock = vi.fn(async (id: string) =>
    id === 'mgr-1' ? { staffId: 'mgr-1', businessId: 'biz-1', role: 'manager' } : null,
  )
  const kvIncrMock = vi.fn(async () => state.rateLimitCount)

  return {
    state,
    sendMock,
    getCheckInsByNodeMock,
    querySubscriptionPaymentsMock,
    getBusinessByIdMock,
    getStaffByIdMock,
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
  return { ...actual, kvGet: vi.fn(async () => null), kvIncr: h.kvIncrMock, kvTtl: vi.fn(async () => 60) }
})

vi.mock('../../check-in/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../check-in/dynamodb-repository.js')>()
  return { ...actual, getCheckInsByNode: h.getCheckInsByNodeMock }
})

vi.mock('../../auth/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/dynamodb-repository.js')>()
  return { ...actual, getBusinessById: h.getBusinessByIdMock, getStaffById: h.getStaffByIdMock }
})

// The subscription-payment read is a repository concern; stub just that helper so
// the paid window's start instant is a stated fact in each test.
vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repository.js')>()
  return { ...actual, querySubscriptionPaymentsForBusiness: h.querySubscriptionPaymentsMock }
})

// Stand-in for the Cognito verifier: same contract (401 without a bearer token,
// `request.auth` on success) without reaching JWKS. The bearer token names the
// session, so one harness drives owner, manager and anonymous callers.
vi.mock('../../../shared/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/middleware/auth.js')>()
  const SESSIONS: Record<string, { userId: string; role: string; cognitoSub: string }> = {
    owner: { userId: 'biz-1', role: 'business', cognitoSub: 'sub-owner' },
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

import { digestWeekFor } from '../../reports/digest.js'
import { businessRoutes } from '../handler.js'
import { TRIAL_DAYS } from '../types.js'

// ─── Harness ─────────────────────────────────────────────────────────────────

type Handler = (request: unknown, reply: unknown) => unknown | Promise<unknown>

interface CapturedRoute {
  url: string
  opts: { preHandler: Handler[] }
  handler: Handler
}

const DAY_MS = 24 * 60 * 60 * 1000

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
  const route = routes.find((r) => r.url === '/v1/business/receipt')
  if (!route) throw new Error('receipt route not registered')
  return route
}

/** Run the real preHandler chain, then the handler, as Fastify would. */
async function get(query: unknown, token: string | null = 'owner') {
  const route = await getRoute()
  const req = {
    query,
    ip: '203.0.113.7',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  }
  const reply = { status: () => reply, send: () => reply }
  for (const pre of route.opts.preHandler) await pre(req, reply)
  return (await route.handler(req, reply)) as import('@area-code/shared/types').BusinessReceipt
}

/** The window `getReceiptForWindow` was asked for, read off the node check-in read. */
function checkInRows(pairs: Array<[string, string | undefined]>, agoDays: number) {
  return pairs.map(([userId, foundVia], i) => ({
    userId,
    checkedInAt: new Date(Date.now() - agoDays * DAY_MS + i * 60_000).toISOString(),
    ...(foundVia === undefined ? {} : { foundVia }),
  }))
}

beforeEach(() => {
  h.state.business = {
    businessId: 'biz-1',
    tier: 'growth',
    trialEndsAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    paidUntil: null,
  }
  h.state.payments = []
  h.state.checkIns = []
  h.state.rateLimitCount = 1
  h.sendMock.mockClear()
  h.getCheckInsByNodeMock.mockClear()
  h.querySubscriptionPaymentsMock.mockClear()
})

// ─── Auth and permission (owner only) ────────────────────────────────────────

describe('GET /v1/business/receipt — who may read it (R6.2)', () => {
  it('reads nothing for an unauthenticated caller', async () => {
    await expect(get({ window: 'trial' }, null)).rejects.toMatchObject({ statusCode: 401 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('refuses a manager: renewal numbers are owner-only', async () => {
    await expect(get({ window: 'trial' }, 'manager')).rejects.toMatchObject({ statusCode: 403 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('serves the owner', async () => {
    const body = await get({ window: 'trial' })

    expect(body.window).toBe('trial')
    expect(typeof body.headline).toBe('string')
  })

  it('rate limits the read with the shared sliding window', async () => {
    h.state.rateLimitCount = 10_000

    await expect(get({ window: 'trial' })).rejects.toMatchObject({ statusCode: 429 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })
})

// ─── Window validation ───────────────────────────────────────────────────────

describe('GET /v1/business/receipt — window validation (R6.2)', () => {
  it('requires a window', async () => {
    await expect(get({})).rejects.toMatchObject({ statusCode: 400 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('rejects a window outside the three it reports', async () => {
    await expect(get({ window: 'month' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects `today`: a copy label, not a window this endpoint reports', async () => {
    await expect(get({ window: 'today' })).rejects.toMatchObject({ statusCode: 400 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('accepts each of the three windows', async () => {
    h.state.business = { ...h.state.business, paidUntil: new Date(Date.now() + 5 * DAY_MS).toISOString() }
    h.state.payments = [{ paidAt: new Date(Date.now() - 25 * DAY_MS).toISOString() }]

    for (const window of ['trial', 'paid', 'week'] as const) {
      const body = await get({ window })
      expect(body.window).toBe(window)
    }
  })
})

// ─── Window resolution from the subscription ─────────────────────────────────

describe('GET /v1/business/receipt — the window comes from the subscription (R6.2)', () => {
  it('trial: opens TRIAL_DAYS before trialEndsAt and closes at now while the trial runs', async () => {
    const trialEndsAt = new Date(Date.now() + 3 * DAY_MS).toISOString()
    h.state.business = { ...h.state.business, trialEndsAt }

    const body = await get({ window: 'trial' })

    expect(Date.parse(body.windowStartUtc)).toBe(Date.parse(trialEndsAt) - TRIAL_DAYS * DAY_MS)
    // Still running, so the window is reported up to now, never out to the end date.
    expect(Date.parse(body.windowEndUtc)).toBeLessThanOrEqual(Date.now())
    expect(Date.parse(body.windowEndUtc)).toBeLessThan(Date.parse(trialEndsAt))
  })

  it('trial: a finished trial closes at trialEndsAt', async () => {
    const trialEndsAt = new Date(Date.now() - 2 * DAY_MS).toISOString()
    h.state.business = { ...h.state.business, trialEndsAt }

    const body = await get({ window: 'trial' })

    expect(body.windowEndUtc).toBe(trialEndsAt)
  })

  it('trial: a business that never trialled is told so, not given a substitute window', async () => {
    h.state.business = { businessId: 'biz-1', tier: 'growth', trialEndsAt: null, paidUntil: null }

    await expect(get({ window: 'trial' })).rejects.toMatchObject({ statusCode: 400 })
    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
  })

  it('paid: runs from the payment that bought the window to paidUntil', async () => {
    const paidAt = new Date(Date.now() - 25 * DAY_MS).toISOString()
    const paidUntil = new Date(Date.now() - 1 * DAY_MS).toISOString()
    h.state.business = { ...h.state.business, paidUntil }
    h.state.payments = [{ paidAt }]

    const body = await get({ window: 'paid' })

    expect(body.windowStartUtc).toBe(paidAt)
    expect(body.windowEndUtc).toBe(paidUntil)
  })

  it('paid: no payment on record is a stated failure, never a guessed period', async () => {
    h.state.business = { ...h.state.business, paidUntil: new Date(Date.now() + DAY_MS).toISOString() }
    h.state.payments = []

    await expect(get({ window: 'paid' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('week: is the current Digest_Week, so the panel and the Monday digest agree', async () => {
    const body = await get({ window: 'week' })
    const week = digestWeekFor(new Date().toISOString())

    expect(body.windowStartUtc).toBe(week.windowStartUtc)
    expect(body.windowEndUtc).toBe(week.windowEndUtc)
  })

  it('reads the subscription-payment row only for the paid window', async () => {
    await get({ window: 'trial' })
    expect(h.querySubscriptionPaymentsMock).not.toHaveBeenCalled()

    h.state.business = { ...h.state.business, paidUntil: new Date(Date.now() + DAY_MS).toISOString() }
    h.state.payments = [{ paidAt: new Date(Date.now() - 2 * DAY_MS).toISOString() }]
    await get({ window: 'paid' })
    expect(h.querySubscriptionPaymentsMock).toHaveBeenCalledTimes(1)
  })
})

// ─── The Receipt and its copy ────────────────────────────────────────────────

describe('GET /v1/business/receipt — Receipt plus copy (R6.2, R6.3)', () => {
  it('splits the window into Found_You and Walk_In visitors and words both lines', async () => {
    // Inside the trial window: three found you (one twice), two walk-ins.
    h.state.checkIns = [
      ...checkInRows(
        [
          ['u1', 'map'],
          ['u1', 'map'],
          ['u2', 'share'],
          ['u3', 'push'],
          ['u4', undefined],
          ['u5', undefined],
        ],
        2,
      ),
    ]

    const body = await get({ window: 'trial' })

    expect(body.foundYouVisitors).toBe(3)
    expect(body.walkInVisitors).toBe(2)
    expect(body.headline).toContain('3 people found you on Area Code and checked in during your trial.')
    expect(body.walkIn).toContain('already in the room')
    // Measurement only: the endpoint never claims Area Code caused the visit.
    expect(`${body.headline} ${body.walkIn}`).not.toMatch(/brought|drove|generated|boosted/i)
  })

  it('omits the first-timer clause rather than reporting an unmeasured zero', async () => {
    h.state.checkIns = checkInRows([['u1', 'map']], 1)

    const body = await get({ window: 'trial' })

    expect(body.firstTimers).toBeNull()
  })

  it('counts only check-ins inside the window', async () => {
    // One inside the trial window, one from long before it opened.
    h.state.checkIns = [...checkInRows([['u1', 'map']], 1), ...checkInRows([['u9', 'map']], 400)]

    const body = await get({ window: 'trial' })

    expect(body.foundYouVisitors).toBe(1)
    expect(body.walkInVisitors).toBe(0)
  })

  it('a quiet window states it plainly and offers one next step from the checklist', async () => {
    h.state.checkIns = []
    // Onboarding reads: nodes come back from the BusinessIndex query, rewards
    // and staff are empty, so the missing step is the get.
    const body = await get({ window: 'trial' })

    expect(body.foundYouVisitors).toBe(0)
    expect(body.headline).not.toMatch(/\b0\b/)
    expect(body.headline.toLowerCase()).toContain('no one has found you')
    expect(body.nextStep).not.toBeNull()
    expect(body.nextStep?.step).toBe('reward')
    expect(body.nextStep?.text.length).toBeGreaterThan(0)
  })

  it('offers no next step once the window has Found_You visitors', async () => {
    h.state.checkIns = checkInRows([['u1', 'map']], 1)

    const body = await get({ window: 'trial' })

    expect(body.nextStep).toBeNull()
  })
})
