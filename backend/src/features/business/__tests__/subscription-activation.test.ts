/**
 * Subscription activation unit tests (billing-revenue-integrity task 4.2).
 *
 * Validates: Requirements 2.4, 2.5
 *
 * Exercises the subscription branch of `handlePaymentSucceeded` /
 * `persistSubscriptionPayment` through the one exported entry point,
 * `processYocoWebhook`, driving design.md Flow 1:
 *
 *   1. Happy path        — valid payment writes marker + row and activates the
 *                          Business_Row with tier / paidUntil / paidInterval,
 *                          paidUntil = addPaidInterval(max(now, existing), i).
 *   2. Renewal           — an existing future paidUntil extends from that value,
 *                          not from now.
 *   3. Duplicate replay  — a redelivery under a fresh eventId hits the marker,
 *                          reconciles from the stored row's paidUntilProduced,
 *                          re-asserts the SAME window, writes no second row (R2.4).
 *   4. Malformed metadata — bad plan / bad interval / unsupported combo / missing
 *                          businessId / missing checkoutId all THROW so the webhook
 *                          returns non-2xx and Yoco retries (R2.5), touching no state.
 *   5. Crash injection   — a failure between marker and row write, and between row
 *                          write and business update, both heal on retry to a single
 *                          row and a single window (idempotence, R2.4).
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * `processYocoWebhook` returns early in DEV_MODE, so the env is `dev` +
 * `AREA_CODE_FORCE_LIVE` (DEV_MODE off, requireEnv keeps local defaults, the
 * Payment_Config_Guard stays lenient because env is `dev`). The service is
 * imported dynamically in `beforeAll` after the env is set — the same pattern as
 * the sibling `webhook-signature.test.ts`.
 *
 * `../repository.js` is mocked with a stateful in-memory double that models the
 * marker-first choreography of `putSubscriptionPaymentWithMarker` and two crash
 * injection points (`failRowWrite`, `failActivate`), mirroring the booster
 * idempotence unit test. `node:crypto` is real, so a genuine HMAC over the raw
 * body passes the signature gate. `Date` is faked for a deterministic paidUntil.
 */

import { createHmac } from 'node:crypto'

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

import { addPaidInterval, BUSINESS_PLANS } from '../types.js'

const SECRET = 'whsec_test_secret'
const BUSINESS_ID = 'biz-42'
const FIXED_NOW_ISO = '2026-03-15T10:00:00.000Z'

// ─── Stateful in-memory repository double ────────────────────────────────────
//
// `vi.hoisted` so the mock functions and the shared mutable state are in scope
// inside the hoisted `vi.mock(...)` factory below.

const h = vi.hoisted(() => {
  type WebhookStatus = 'processing' | 'processed' | 'failed'

  interface State {
    business: Record<string, unknown> | null
    webhookEvents: Map<string, WebhookStatus>
    markers: Map<string, unknown>
    rows: Map<string, Record<string, unknown>>
    activateCalls: Array<{ businessId: string; args: Record<string, unknown> }>
    // Crash between marker write and row write: models the repo landing the
    // marker, failing the row write non-conditionally, compensating-deleting the
    // marker, then rethrowing. Net effect: nothing persisted, error surfaces.
    failRowWrite: boolean
    // Crash between row write and business update: putSubscriptionPaymentWithMarker
    // returns 'written' (marker + row persisted), then activation throws once.
    failActivate: boolean
  }

  const state: State = {
    business: null,
    webhookEvents: new Map(),
    markers: new Map(),
    rows: new Map(),
    activateCalls: [],
    failRowWrite: false,
    failActivate: false,
  }

  const throughputError = (): Error => {
    const e = new Error('The level of configured provisioned throughput was exceeded.') as Error & { name: string }
    e.name = 'ProvisionedThroughputExceededException'
    return e
  }

  const claimWebhookEvent = vi.fn(async (eventId: string) => {
    const status = state.webhookEvents.get(eventId)
    if (status === 'processed') return 'processed' as const
    if (status === 'processing') return 'processing' as const
    state.webhookEvents.set(eventId, 'processing')
    return 'claimed' as const
  })
  const markWebhookEventProcessed = vi.fn(async (eventId: string) => {
    if (state.webhookEvents.get(eventId) !== 'processing') throw new Error('Webhook event is not processing')
    state.webhookEvents.set(eventId, 'processed')
  })
  const markWebhookEventFailed = vi.fn(async (eventId: string) => {
    if (state.webhookEvents.get(eventId) !== 'processing') throw new Error('Webhook event is not processing')
    state.webhookEvents.set(eventId, 'failed')
  })
  const findBusinessById = vi.fn(async (_id: string) => (state.business ? { ...state.business } : null))

  const putSubscriptionPaymentWithMarker = vi.fn(
    async ({ purchase, marker }: { purchase: Record<string, unknown>; marker: unknown }) => {
      if (state.failRowWrite) {
        state.failRowWrite = false
        throw throughputError()
      }
      const yid = purchase['yocoCheckoutId'] as string
      if (state.markers.has(yid)) return { result: 'duplicate' as const }
      state.markers.set(yid, marker)
      const rowKey = `${String(purchase['pk'])}\u0000${String(purchase['sk'])}`
      if (state.rows.has(rowKey)) return { result: 'duplicate' as const }
      state.rows.set(rowKey, purchase)
      return { result: 'written' as const }
    },
  )

  const getSubCheckoutMarker = vi.fn(async (yid: string) => state.markers.get(yid) ?? null)
  const getSubscriptionPaymentByKey = vi.fn(
    async (pk: string, sk: string) => state.rows.get(`${pk}\u0000${sk}`) ?? null,
  )

  const activateSubscriptionOnBusiness = vi.fn(async (businessId: string, args: Record<string, unknown>) => {
    if (state.failActivate) {
      state.failActivate = false
      throw new Error('activation UpdateItem failed')
    }
    state.activateCalls.push({ businessId, args })
    if (state.business) {
      state.business['tier'] = args['tier']
      state.business['paidUntil'] = args['paidUntil']
      state.business['paidInterval'] = args['paidInterval']
    }
    return {}
  })

  return {
    state,
    claimWebhookEvent,
    markWebhookEventProcessed,
    markWebhookEventFailed,
    findBusinessById,
    putSubscriptionPaymentWithMarker,
    getSubCheckoutMarker,
    getSubscriptionPaymentByKey,
    activateSubscriptionOnBusiness,
  }
})

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    claimWebhookEvent: h.claimWebhookEvent,
    markWebhookEventProcessed: h.markWebhookEventProcessed,
    markWebhookEventFailed: h.markWebhookEventFailed,
    findBusinessById: h.findBusinessById,
    putSubscriptionPaymentWithMarker: h.putSubscriptionPaymentWithMarker,
    getSubCheckoutMarker: h.getSubCheckoutMarker,
    getSubscriptionPaymentByKey: h.getSubscriptionPaymentByKey,
    activateSubscriptionOnBusiness: h.activateSubscriptionOnBusiness,
  }
})

let processYocoWebhook: (typeof import('../service.js'))['processYocoWebhook']

beforeAll(async () => {
  // DEV_MODE off so the real webhook path runs; env stays `dev` so requireEnv
  // keeps local defaults and the Payment_Config_Guard is lenient at import.
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  process.env['YOCO_WEBHOOK_SECRET'] = SECRET
  ;({ processYocoWebhook } = await import('../service.js'))
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FIXED_NOW_ISO))

  h.state.business = {
    businessId: BUSINESS_ID,
    tier: 'growth',
    paidUntil: null,
    trialEndsAt: '2026-01-01T00:00:00.000Z',
  }
  h.state.webhookEvents.clear()
  h.state.markers.clear()
  h.state.rows.clear()
  h.state.activateCalls.length = 0
  h.state.failRowWrite = false
  h.state.failActivate = false

  h.claimWebhookEvent.mockClear()
  h.markWebhookEventProcessed.mockClear()
  h.markWebhookEventFailed.mockClear()
  h.findBusinessById.mockClear()
  h.putSubscriptionPaymentWithMarker.mockClear()
  h.getSubCheckoutMarker.mockClear()
  h.getSubscriptionPaymentByKey.mockClear()
  h.activateSubscriptionOnBusiness.mockClear()

  process.env['YOCO_WEBHOOK_SECRET'] = SECRET
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface SubOverrides {
  businessId?: string
  plan?: unknown
  interval?: unknown
  checkoutId?: string | null // null = omit every checkout-id source (missing id case)
  paidAt?: string
}

function subscriptionAmount(plan: unknown, interval: unknown): number {
  if (plan === 'payg') {
    return interval === 'weekly' ? BUSINESS_PLANS.payg.weeklyPrice : BUSINESS_PLANS.payg.dailyPrice
  }
  if (plan === 'pro') {
    return interval === 'yearly' ? BUSINESS_PLANS.pro.yearlyPrice : BUSINESS_PLANS.pro.monthlyPrice
  }
  return interval === 'yearly' ? BUSINESS_PLANS.growth.yearlyPrice : BUSINESS_PLANS.growth.monthlyPrice
}

function subPayload(overrides: SubOverrides = {}): Record<string, unknown> {
  const plan = 'plan' in overrides ? overrides.plan : 'growth'
  const interval = 'interval' in overrides ? overrides.interval : 'monthly'
  const metadata: Record<string, unknown> = {
    type: 'subscription',
    businessId: 'businessId' in overrides ? overrides.businessId : BUSINESS_ID,
    plan,
    interval,
  }
  if (overrides.checkoutId !== null) {
    metadata['checkoutId'] = overrides.checkoutId ?? 'chk_default'
  }
  return {
    metadata,
    amount: subscriptionAmount(plan, interval),
    currency: 'ZAR',
    paidAt: overrides.paidAt ?? FIXED_NOW_ISO,
  }
}

async function deliver(eventId: string, payload: Record<string, unknown>): Promise<unknown> {
  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex')
  return processYocoWebhook(eventId, 'payment.succeeded', payload, signature, rawBody)
}

function persistedRows(): Array<Record<string, unknown>> {
  return [...h.state.rows.values()]
}

// ─── 1. Happy path ────────────────────────────────────────────────────────────

describe('subscription activation: happy path (R2.4, R2.5)', () => {
  it('writes exactly one marker + row and activates with correct tier/paidUntil/paidInterval', async () => {
    await deliver('evt-1', subPayload({ plan: 'growth', interval: 'monthly', checkoutId: 'chk_growth' }))

    const expectedPaidUntil = addPaidInterval(FIXED_NOW_ISO, 'monthly')

    expect(h.state.rows.size).toBe(1)
    expect(h.state.markers.size).toBe(1)
    expect(h.state.activateCalls).toHaveLength(1)
    expect(h.state.activateCalls[0]).toEqual({
      businessId: BUSINESS_ID,
      args: { tier: 'growth', paidUntil: expectedPaidUntil, paidInterval: 'monthly' },
    })

    const row = persistedRows()[0]!
    expect(row['plan']).toBe('growth')
    expect(row['interval']).toBe('monthly')
    expect(row['amountCents']).toBe(BUSINESS_PLANS.growth.monthlyPrice)
    expect(row['currency']).toBe('ZAR')
    expect(row['yocoCheckoutId']).toBe('chk_growth')
    expect(row['paidUntilProduced']).toBe(expectedPaidUntil)
  })

  it('computes paidUntil from now for a payg daily pass with the daily price', async () => {
    await deliver('evt-payg', subPayload({ plan: 'payg', interval: 'daily', checkoutId: 'chk_payg' }))

    const expectedPaidUntil = addPaidInterval(FIXED_NOW_ISO, 'daily')
    expect(h.state.activateCalls).toHaveLength(1)
    expect(h.state.activateCalls[0]!.args).toEqual({
      tier: 'payg',
      paidUntil: expectedPaidUntil,
      paidInterval: 'daily',
    })
    expect(persistedRows()[0]!['amountCents']).toBe(BUSINESS_PLANS.payg.dailyPrice)
  })
})

// ─── 2. Renewal extends from the existing future window ─────────────────────────

describe('subscription activation: renewal (R2.3)', () => {
  it('extends from an existing future paidUntil, not from now', async () => {
    const futurePaidUntil = '2026-05-01T00:00:00.000Z' // well after FIXED_NOW
    h.state.business!['paidUntil'] = futurePaidUntil

    await deliver('evt-renew', subPayload({ plan: 'growth', interval: 'monthly', checkoutId: 'chk_renew' }))

    const expectedPaidUntil = addPaidInterval(futurePaidUntil, 'monthly')
    expect(expectedPaidUntil).not.toBe(addPaidInterval(FIXED_NOW_ISO, 'monthly'))
    expect(h.state.activateCalls).toHaveLength(1)
    expect(h.state.activateCalls[0]!.args['paidUntil']).toBe(expectedPaidUntil)
    expect(persistedRows()[0]!['paidUntilProduced']).toBe(expectedPaidUntil)
  })

  it('ignores a lapsed (past) paidUntil and extends from now', async () => {
    h.state.business!['paidUntil'] = '2026-01-01T00:00:00.000Z' // before FIXED_NOW

    await deliver('evt-lapsed', subPayload({ plan: 'growth', interval: 'monthly', checkoutId: 'chk_lapsed' }))

    expect(h.state.activateCalls[0]!.args['paidUntil']).toBe(addPaidInterval(FIXED_NOW_ISO, 'monthly'))
  })
})

// ─── 3. Duplicate checkout replay ───────────────────────────────────────────────

describe('subscription activation: duplicate checkout replay (R2.4)', () => {
  it('reconciles from the stored row on redelivery, re-asserting the SAME window with no second row', async () => {
    const payload = subPayload({ plan: 'pro', interval: 'yearly', checkoutId: 'chk_dup' })

    // First delivery.
    await deliver('evt-a', payload)
    const firstPaidUntil = h.state.activateCalls[0]!.args['paidUntil']

    // Redelivery of the SAME yocoCheckoutId under a FRESH eventId.
    await deliver('evt-b', payload)

    // No second row, no second marker.
    expect(h.state.rows.size).toBe(1)
    expect(h.state.markers.size).toBe(1)

    // Activation was re-asserted, but with the SAME window (no second extension).
    expect(h.state.activateCalls).toHaveLength(2)
    expect(h.state.activateCalls[1]!.args['paidUntil']).toBe(firstPaidUntil)
    expect(h.state.activateCalls[1]!.args).toEqual(h.state.activateCalls[0]!.args)

    // The reconciliation path read the marker and the stored row.
    expect(h.getSubCheckoutMarker).toHaveBeenCalledWith('chk_dup')
    expect(h.getSubscriptionPaymentByKey).toHaveBeenCalled()
  })
})

// ─── 4. Malformed metadata throws (R2.5) ────────────────────────────────────────

describe('subscription activation: malformed metadata throws (R2.5)', () => {
  const cases: Array<{ name: string; overrides: SubOverrides }> = [
    { name: 'unknown plan', overrides: { plan: 'enterprise', checkoutId: 'chk_bad_plan' } },
    { name: 'unknown interval', overrides: { interval: 'fortnightly', checkoutId: 'chk_bad_int' } },
    {
      name: 'unsupported plan/interval combo (growth + daily)',
      overrides: { plan: 'growth', interval: 'daily', checkoutId: 'chk_combo' },
    },
    { name: 'missing businessId', overrides: { businessId: '', checkoutId: 'chk_no_biz' } },
    { name: 'missing yocoCheckoutId', overrides: { checkoutId: null } },
  ]

  for (const { name, overrides } of cases) {
    it(`throws for ${name} and touches no state`, async () => {
      await expect(deliver(`evt-${name}`, subPayload(overrides))).rejects.toBeInstanceOf(Error)

      expect(h.state.rows.size).toBe(0)
      expect(h.state.markers.size).toBe(0)
      expect(h.state.activateCalls).toHaveLength(0)
    })
  }
})

// ─── 5. Crash injection heals to a single row + single window (R2.4) ────────────

describe('subscription activation: crash injection idempotence (R2.4)', () => {
  it('crash between marker and row write: retry heals to one row and one window', async () => {
    const payload = subPayload({ plan: 'growth', interval: 'monthly', checkoutId: 'chk_crash1' })

    // Crash on the first delivery's row write (marker compensating-deleted, throw).
    h.state.failRowWrite = true
    await expect(deliver('evt-c1', payload)).rejects.toBeInstanceOf(Error)

    // Nothing persisted, nothing activated, and the failed event is reclaimable.
    expect(h.state.rows.size).toBe(0)
    expect(h.state.markers.size).toBe(0)
    expect(h.state.activateCalls).toHaveLength(0)
    expect(h.state.webhookEvents.get('evt-c1')).toBe('failed')

    // Yoco retry of the same failed event reclaims it and lands cleanly.
    await deliver('evt-c1', payload)

    expect(h.state.rows.size).toBe(1)
    expect(h.state.markers.size).toBe(1)
    expect(h.state.activateCalls).toHaveLength(1)
    expect(h.state.activateCalls[0]!.args['paidUntil']).toBe(addPaidInterval(FIXED_NOW_ISO, 'monthly'))
    expect(h.state.webhookEvents.get('evt-c1')).toBe('processed')
  })

  it('crash between row write and business update: retry reconciles to one row and one window', async () => {
    const payload = subPayload({ plan: 'growth', interval: 'monthly', checkoutId: 'chk_crash2' })

    // First delivery: marker + row persist, then activation throws.
    h.state.failActivate = true
    await expect(deliver('evt-c2', payload)).rejects.toBeInstanceOf(Error)

    // Row + marker landed, but the business was never activated. The event is failed and reclaimable.
    expect(h.state.rows.size).toBe(1)
    expect(h.state.markers.size).toBe(1)
    expect(h.state.activateCalls).toHaveLength(0)
    expect(h.state.webhookEvents.get('evt-c2')).toBe('failed')

    const producedPaidUntil = persistedRows()[0]!['paidUntilProduced']

    // Retry the same event: failed claim → duplicate marker → reconciliation.
    await deliver('evt-c2', payload)

    // Still exactly one row; activation now re-asserted from the stored window.
    expect(h.state.rows.size).toBe(1)
    expect(h.state.markers.size).toBe(1)
    expect(h.state.activateCalls).toHaveLength(1)
    expect(h.state.activateCalls[0]!.args['paidUntil']).toBe(producedPaidUntil)
    expect(producedPaidUntil).toBe(addPaidInterval(FIXED_NOW_ISO, 'monthly'))
    expect(h.state.webhookEvents.get('evt-c2')).toBe('processed')
  })
})
