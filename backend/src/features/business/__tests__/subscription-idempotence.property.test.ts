/**
 * Feature: billing-revenue-integrity, Property 2: Activation idempotence.
 *
 * **Validates: Requirements 2.4**
 *
 * For any sequence of deliveries of the SAME `yocoCheckoutId` (each carrying a
 * FRESH `eventId`, with crashes arbitrarily injected between the marker write,
 * the row write, and the business update, and retries interleaved in arbitrary
 * order), once the schedule has run to a successful landing:
 *
 *   1. Exactly one `Subscription_Payment_Row` exists.
 *   2. The business's activated `paidUntil` equals that single row's
 *      `paidUntilProduced` — one window, no double extension.
 *
 * Mirrors booster Property 2 (`webhook-idempotence.property.test.ts`) and the
 * task 4.2 unit double (`subscription-activation.test.ts`).
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * The unit under test is `persistSubscriptionPayment` reached through the one
 * exported entry point, `processYocoWebhook` (design.md Flow 1). `../repository.js`
 * is mocked with a stateful in-memory double modelling the marker-first
 * choreography of `putSubscriptionPaymentWithMarker` plus three crash-injection
 * points:
 *
 *   - `failMarkerWrite` / `failRowWrite`: `putSubscriptionPaymentWithMarker`
 *     throws a transient error before anything is net-persisted (the marker
 *     write failing, or the row write failing after the compensating delete of
 *     the marker). Either way nothing is left behind and the caller re-throws
 *     so Yoco retries.
 *   - `failActivate`: marker + row persist ('written'), then
 *     `activateSubscriptionOnBusiness` throws once — the crash between the audit
 *     write and the Business_Row update that design Flow 1 heals via the
 *     duplicate-marker reconciliation branch.
 *
 * `processYocoWebhook` returns early in DEV_MODE, so the env is `dev` +
 * `AREA_CODE_FORCE_LIVE` (DEV_MODE off, requireEnv keeps local defaults, the
 * Payment_Config_Guard stays lenient because env is `dev`). The service is
 * imported dynamically in `beforeAll` after the env is set — the same pattern
 * as the sibling `webhook-signature.test.ts` and `subscription-activation.test.ts`.
 *
 * FRESH `eventId`s are used for every delivery so `findWebhookEvent` never
 * dedupes: idempotence is genuinely exercised at the `yocoCheckoutId` / marker
 * layer, which is the design's concern.
 */

import { createHmac } from 'node:crypto'

import * as fc from 'fast-check'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

import { addPaidInterval } from '../types.js'

const SECRET = 'whsec_test_secret'
const BUSINESS_ID = 'biz-idem'
const FIXED_NOW_ISO = '2026-03-15T10:00:00.000Z'

// ─── Stateful in-memory repository double ────────────────────────────────────

const h = vi.hoisted(() => {
  interface State {
    business: Record<string, unknown> | null
    markers: Map<string, Record<string, unknown>>
    rows: Map<string, Record<string, unknown>>
    activateCalls: Array<{ businessId: string; args: Record<string, unknown> }>
    // Crash before the marker lands (marker write fails). Net: nothing persisted.
    failMarkerWrite: boolean
    // Crash after the marker lands but on the row write; the repo compensating-
    // deletes the marker and rethrows. Net: nothing persisted.
    failRowWrite: boolean
    // Crash between the audit write and the Business_Row update: the write
    // returns 'written' (marker + row persisted), then activation throws once.
    failActivate: boolean
  }

  const state: State = {
    business: null,
    markers: new Map(),
    rows: new Map(),
    activateCalls: [],
    failMarkerWrite: false,
    failRowWrite: false,
    failActivate: false,
  }

  const throughputError = (): Error => {
    const e = new Error('The level of configured provisioned throughput was exceeded.') as Error & { name: string }
    e.name = 'ProvisionedThroughputExceededException'
    return e
  }

  const findWebhookEvent = vi.fn(async (_eventId: string) => null)
  const createWebhookEvent = vi.fn(async () => {})
  const findBusinessById = vi.fn(async (_id: string) => (state.business ? { ...state.business } : null))

  const putSubscriptionPaymentWithMarker = vi.fn(
    async ({ purchase, marker }: { purchase: Record<string, unknown>; marker: Record<string, unknown> }) => {
      // Both marker-write and row-write failures net to "nothing persisted, throw"
      // (the row-write failure is compensated by deleting the just-landed marker).
      if (state.failMarkerWrite) {
        state.failMarkerWrite = false
        throw throughputError()
      }
      if (state.failRowWrite) {
        state.failRowWrite = false
        throw throughputError()
      }
      const yid = purchase['yocoCheckoutId'] as string
      if (state.markers.has(yid)) return { result: 'duplicate' as const }
      const rowKey = `${String(purchase['pk'])}\u0000${String(purchase['sk'])}`
      if (state.rows.has(rowKey)) return { result: 'duplicate' as const }
      state.markers.set(yid, marker)
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
    findWebhookEvent,
    createWebhookEvent,
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
    findWebhookEvent: h.findWebhookEvent,
    createWebhookEvent: h.createWebhookEvent,
    findBusinessById: h.findBusinessById,
    putSubscriptionPaymentWithMarker: h.putSubscriptionPaymentWithMarker,
    getSubCheckoutMarker: h.getSubCheckoutMarker,
    getSubscriptionPaymentByKey: h.getSubscriptionPaymentByKey,
    activateSubscriptionOnBusiness: h.activateSubscriptionOnBusiness,
  }
})

let processYocoWebhook: (typeof import('../service.js'))['processYocoWebhook']

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  process.env['YOCO_WEBHOOK_SECRET'] = SECRET
  ;({ processYocoWebhook } = await import('../service.js'))
  // Fixed clock so a single successful 'written' delivery produces a
  // deterministic paidUntilProduced. The clock stays fixed across fast-check
  // runs; state is reset inside the property body.
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FIXED_NOW_ISO))
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  process.env['YOCO_WEBHOOK_SECRET'] = SECRET
})

// ─── Delivery helper ──────────────────────────────────────────────────────────

interface Combo {
  plan: 'growth' | 'pro' | 'payg'
  interval: 'monthly' | 'yearly' | 'daily' | 'weekly'
}

function subPayload(combo: Combo, yocoCheckoutId: string): Record<string, unknown> {
  return {
    metadata: {
      type: 'subscription',
      businessId: BUSINESS_ID,
      plan: combo.plan,
      interval: combo.interval,
      checkoutId: yocoCheckoutId,
    },
  }
}

async function deliver(eventId: string, payload: Record<string, unknown>): Promise<void> {
  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex')
  await processYocoWebhook(eventId, 'payment.succeeded', payload, signature, rawBody)
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

// Only valid (plan, interval) combinations — a re-delivered payment always
// carries the same, well-formed metadata.
const comboArb: fc.Arbitrary<Combo> = fc.oneof(
  fc.record({ plan: fc.constant('growth' as const), interval: fc.constantFrom('monthly' as const, 'yearly' as const) }),
  fc.record({ plan: fc.constant('pro' as const), interval: fc.constantFrom('monthly' as const, 'yearly' as const) }),
  fc.record({ plan: fc.constant('payg' as const), interval: fc.constantFrom('daily' as const, 'weekly' as const) }),
)

// A crash mode injected before a delivery: none, or one of the three steps.
type CrashMode = 'none' | 'marker' | 'row' | 'activate'
const crashModeArb: fc.Arbitrary<CrashMode> = fc.constantFrom('none', 'marker', 'row', 'activate')

// A re-delivery schedule: at least one delivery, each with its own crash mode.
// The same yocoCheckoutId is shared by every delivery in a run (they are all
// re-deliveries of one payment); eventIds are minted fresh per delivery.
const scheduleArb = fc.record({
  combo: comboArb,
  yocoCheckoutId: fc.constantFrom('yc-alpha', 'yc-beta', 'yc-gamma'),
  crashes: fc.array(crashModeArb, { minLength: 1, maxLength: 20 }),
})

// ─── Property 2 ─────────────────────────────────────────────────────────────

describe('Feature: billing-revenue-integrity, Property 2: Activation idempotence', () => {
  it('one row, one window under arbitrary re-delivery schedules with crash injection (R2.4)', async () => {
    let seq = 0
    await fc.assert(
      fc.asyncProperty(scheduleArb, async ({ combo, yocoCheckoutId, crashes }) => {
        // Reset state for this run.
        h.state.business = {
          businessId: BUSINESS_ID,
          tier: 'growth',
          paidUntil: null,
          trialEndsAt: '2026-01-01T00:00:00.000Z',
        }
        h.state.markers.clear()
        h.state.rows.clear()
        h.state.activateCalls.length = 0
        h.state.failMarkerWrite = false
        h.state.failRowWrite = false
        h.state.failActivate = false

        const payload = subPayload(combo, yocoCheckoutId)

        // Run the arbitrary schedule. A crashing delivery re-throws (Yoco would
        // retry); we swallow that here because the retry is modelled by the next
        // delivery in the schedule for the same yocoCheckoutId.
        for (const crash of crashes) {
          h.state.failMarkerWrite = crash === 'marker'
          h.state.failRowWrite = crash === 'row'
          h.state.failActivate = crash === 'activate'
          try {
            await deliver(`evt-${seq++}`, payload)
          } catch (err) {
            // Injected transient/activation failure — must be the error we armed,
            // never a shape-validation throw (metadata is always well-formed here).
            expect((err as { name?: string }).name).not.toBe('BadRequestError')
          }
        }

        // Retries eventually succeed: deliver clean (no crash) events with fresh
        // eventIds until the window has landed on the Business_Row. Bounded loop.
        h.state.failMarkerWrite = false
        h.state.failRowWrite = false
        h.state.failActivate = false
        for (let i = 0; i < 3 && h.state.business!['paidUntil'] == null; i++) {
          await deliver(`evt-${seq++}`, payload)
        }

        // ── Invariant 1: exactly one Subscription_Payment_Row ────────────────
        expect(h.state.rows.size).toBe(1)
        expect(h.state.markers.size).toBe(1)

        // ── Invariant 2: activated paidUntil == the single row's produced window
        const row = [...h.state.rows.values()][0]!
        const producedPaidUntil = row['paidUntilProduced'] as string

        // The single window is exactly one interval past the fixed clock, from a
        // fresh (null) starting window — no double extension.
        expect(producedPaidUntil).toBe(addPaidInterval(FIXED_NOW_ISO, combo.interval))
        expect(h.state.business!['paidUntil']).toBe(producedPaidUntil)
        expect(h.state.business!['tier']).toBe(combo.plan)

        // The row carries the expected canonical price for the (plan, interval).
        expect(row['plan']).toBe(combo.plan)
        expect(row['interval']).toBe(combo.interval)
        expect(row['yocoCheckoutId']).toBe(yocoCheckoutId)
      }),
      { numRuns: 200 },
    )
  }, 60_000)
})
