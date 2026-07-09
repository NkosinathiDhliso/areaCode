/**
 * Lapse_Sweep unit tests (billing-revenue-integrity task 6.1).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.6
 *
 * Exercises the two-phase lapse lifecycle in the business service:
 *
 *   Phase 1 (`startLapseSweep`, R3.1/R3.6): a paid business whose `paidUntil`
 *     has lapsed and that has no grace set gets `paymentGraceUntil = now + 7d`
 *     and exactly one renewal-reminder email.
 *   Phase 2 (`enforceLapsedPayments`, R3.3): once the grace window itself
 *     lapses, the business is demoted via `deactivateForNonPayment` (tier→free,
 *     inactive, grace cleared).
 *
 * The two phases across two runs model the full transition
 * (lapsed → grace → demote), plus idempotence (a second phase-1 run does not
 * re-email a business already in grace) and one-email-per-lapse.
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * Env is `dev` + `AREA_CODE_FORCE_LIVE` so DEV_MODE is off (the sweeps run) but
 * `requireEnv` keeps local defaults and the Payment_Config_Guard stays lenient
 * at import — the same pattern as `subscription-activation.test.ts`. The service
 * is imported dynamically in `beforeAll` after the env is set.
 *
 * `../repository.js`, `../nodes/dynamodb-repository.js`, and the SES module are
 * mocked with a stateful in-memory business store that models the two lapse
 * queries (`listBusinessesWithLapsedPaidUntil`, `listBusinessesWithLapsedGrace`)
 * and the grace/demotion writes. `Date` is faked for a deterministic grace date.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

import { SUBSCRIPTION_GRACE_DAYS } from '../types.js'

const FIXED_NOW_ISO = '2026-03-15T10:00:00.000Z'
const DAY_MS = 24 * 60 * 60 * 1000

interface Biz {
  businessId: string
  email: string
  businessName: string
  tier: string
  paidUntil: string | null
  paidInterval: string | null
  paymentGraceUntil: string | null
  trialEndsAt: string | null
  isActive: boolean
}

// ─── Stateful in-memory repository double ────────────────────────────────────

const h = vi.hoisted(() => {
  const state: { businesses: Map<string, Biz>; failGraceFor: Set<string> } = {
    businesses: new Map(),
    failGraceFor: new Set(),
  }

  const isPaid = (tier: string) => tier === 'growth' || tier === 'pro' || tier === 'payg'
  const before = (iso: string | null, nowIso: string) => typeof iso === 'string' && iso < nowIso

  // Mirrors the real filter: paid tier, paidUntil in past, no grace, no active
  // trial. Grace/trial absent OR null both count as "not set".
  const listBusinessesWithLapsedPaidUntil = vi.fn(async (nowIso: string) => {
    const rows: Array<{
      businessId: string
      email: string
      businessName: string
      paidUntil: string
      paidInterval: string | null
    }> = []
    for (const b of state.businesses.values()) {
      const noGrace = b.paymentGraceUntil === null || b.paymentGraceUntil === undefined
      const noActiveTrial = b.trialEndsAt === null || b.trialEndsAt === undefined || before(b.trialEndsAt, nowIso)
      if (isPaid(b.tier) && before(b.paidUntil, nowIso) && noGrace && noActiveTrial) {
        rows.push({
          businessId: b.businessId,
          email: b.email,
          businessName: b.businessName,
          paidUntil: b.paidUntil as string,
          paidInterval: b.paidInterval,
        })
      }
    }
    return rows
  })

  const setPaymentGrace = vi.fn(async (id: string, until: string | null) => {
    if (state.failGraceFor.has(id)) throw new Error(`grace write failed for ${id}`)
    const b = state.businesses.get(id)
    if (b) b.paymentGraceUntil = until
    return {}
  })

  const listBusinessesWithLapsedGrace = vi.fn(async (nowIso: string) => {
    const ids: string[] = []
    for (const b of state.businesses.values()) {
      if (before(b.paymentGraceUntil, nowIso)) ids.push(b.businessId)
    }
    return ids
  })

  const deactivateBusiness = vi.fn(async (id: string) => {
    const b = state.businesses.get(id)
    if (b) {
      b.tier = 'free'
      b.isActive = false
    }
    return {}
  })

  const deactivateNodesForBusiness = vi.fn(async (_id: string) => 0)

  const sendRenewalReminderEmail = vi.fn(async (_to: string, _name: string) => {})

  const createAuditLog = vi.fn(async (_entry: Record<string, unknown>) => ({}))

  return {
    state,
    listBusinessesWithLapsedPaidUntil,
    setPaymentGrace,
    listBusinessesWithLapsedGrace,
    deactivateBusiness,
    deactivateNodesForBusiness,
    sendRenewalReminderEmail,
    createAuditLog,
  }
})

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    listBusinessesWithLapsedPaidUntil: h.listBusinessesWithLapsedPaidUntil,
    setPaymentGrace: h.setPaymentGrace,
    listBusinessesWithLapsedGrace: h.listBusinessesWithLapsedGrace,
    deactivateBusiness: h.deactivateBusiness,
  }
})

vi.mock('../../nodes/dynamodb-repository.js', () => ({
  deactivateNodesForBusiness: h.deactivateNodesForBusiness,
}))

// deactivateForNonPayment writes a system-actor audit entry
// (cross-portal-lifecycle-alignment R2.3) via the admin audit-log repository.
// Mock it so the demotion path stays offline and the entry is assertable.
vi.mock('../../admin/repository.js', () => ({
  createAuditLog: h.createAuditLog,
}))

vi.mock('../../../shared/email/ses.js', () => ({
  sendRenewalReminderEmail: h.sendRenewalReminderEmail,
}))

let startLapseSweep: (typeof import('../service.js'))['startLapseSweep']
let enforceLapsedPayments: (typeof import('../service.js'))['enforceLapsedPayments']

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  process.env['YOCO_WEBHOOK_SECRET'] = 'whsec_test'
  ;({ startLapseSweep, enforceLapsedPayments } = await import('../service.js'))
})

function makeBiz(overrides: Partial<Biz> & { businessId: string }): Biz {
  return {
    email: `${overrides.businessId}@example.com`,
    businessName: `Biz ${overrides.businessId}`,
    tier: 'growth',
    paidUntil: null,
    paidInterval: 'monthly',
    paymentGraceUntil: null,
    trialEndsAt: null,
    isActive: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FIXED_NOW_ISO))
  h.state.businesses.clear()
  h.state.failGraceFor.clear()
  h.listBusinessesWithLapsedPaidUntil.mockClear()
  h.setPaymentGrace.mockClear()
  h.listBusinessesWithLapsedGrace.mockClear()
  h.deactivateBusiness.mockClear()
  h.deactivateNodesForBusiness.mockClear()
  h.sendRenewalReminderEmail.mockClear()
  h.createAuditLog.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startLapseSweep — phase 1 (R3.1, R3.6)', () => {
  it('sets a 7-day grace window and sends exactly one renewal email for a lapsed paid business', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    h.state.businesses.set('biz-1', makeBiz({ businessId: 'biz-1', paidUntil: new Date(nowMs - DAY_MS).toISOString() }))

    const result = await startLapseSweep(nowMs)

    expect(result.graced).toBe(1)
    const expectedGrace = new Date(nowMs + SUBSCRIPTION_GRACE_DAYS * DAY_MS).toISOString()
    expect(h.setPaymentGrace).toHaveBeenCalledWith('biz-1', expectedGrace)
    expect(h.state.businesses.get('biz-1')!.paymentGraceUntil).toBe(expectedGrace)
    expect(h.sendRenewalReminderEmail).toHaveBeenCalledTimes(1)
    expect(h.sendRenewalReminderEmail).toHaveBeenCalledWith('biz-1@example.com', 'Biz biz-1')
  })

  it('does not touch a business whose paid window is still active', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    h.state.businesses.set(
      'biz-future',
      makeBiz({ businessId: 'biz-future', paidUntil: new Date(nowMs + 5 * DAY_MS).toISOString() }),
    )

    const result = await startLapseSweep(nowMs)

    expect(result.graced).toBe(0)
    expect(h.setPaymentGrace).not.toHaveBeenCalled()
    expect(h.sendRenewalReminderEmail).not.toHaveBeenCalled()
  })

  it('sends exactly one email per lapsed business and skips non-lapsed ones', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    h.state.businesses.set('a', makeBiz({ businessId: 'a', paidUntil: new Date(nowMs - DAY_MS).toISOString() }))
    h.state.businesses.set('b', makeBiz({ businessId: 'b', paidUntil: new Date(nowMs - 2 * DAY_MS).toISOString() }))
    // Still active — must not be graced or emailed.
    h.state.businesses.set('c', makeBiz({ businessId: 'c', paidUntil: new Date(nowMs + DAY_MS).toISOString() }))
    // Free tier — never a paid lapse.
    h.state.businesses.set(
      'd',
      makeBiz({ businessId: 'd', tier: 'free', paidUntil: new Date(nowMs - DAY_MS).toISOString() }),
    )

    const result = await startLapseSweep(nowMs)

    expect(result.graced).toBe(2)
    expect(h.sendRenewalReminderEmail).toHaveBeenCalledTimes(2)
    const emailed = h.sendRenewalReminderEmail.mock.calls.map((c) => c[0]).sort()
    expect(emailed).toEqual(['a@example.com', 'b@example.com'])
  })

  it('is idempotent across runs: a second run does not re-email a business already in grace (R3.6)', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    h.state.businesses.set('biz-1', makeBiz({ businessId: 'biz-1', paidUntil: new Date(nowMs - DAY_MS).toISOString() }))

    const first = await startLapseSweep(nowMs)
    const second = await startLapseSweep(nowMs)

    expect(first.graced).toBe(1)
    expect(second.graced).toBe(0)
    expect(h.sendRenewalReminderEmail).toHaveBeenCalledTimes(1)
  })

  it('does not treat an active trial as a lapse even when paidUntil is past', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    h.state.businesses.set(
      'biz-trial',
      makeBiz({
        businessId: 'biz-trial',
        paidUntil: new Date(nowMs - DAY_MS).toISOString(),
        trialEndsAt: new Date(nowMs + 3 * DAY_MS).toISOString(),
      }),
    )

    const result = await startLapseSweep(nowMs)

    expect(result.graced).toBe(0)
    expect(h.sendRenewalReminderEmail).not.toHaveBeenCalled()
  })

  it('logs and skips a per-business failure so one bad row never aborts the sweep', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    h.state.businesses.set('bad', makeBiz({ businessId: 'bad', paidUntil: new Date(nowMs - DAY_MS).toISOString() }))
    h.state.businesses.set('good', makeBiz({ businessId: 'good', paidUntil: new Date(nowMs - DAY_MS).toISOString() }))
    h.state.failGraceFor.add('bad')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await startLapseSweep(nowMs)

    expect(result.graced).toBe(1)
    // 'good' still emailed despite 'bad' throwing before its email.
    expect(h.sendRenewalReminderEmail).toHaveBeenCalledTimes(1)
    expect(h.sendRenewalReminderEmail).toHaveBeenCalledWith('good@example.com', 'Biz good')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('lapse phase transition across two runs (R3.2 → R3.3)', () => {
  it('graces on run 1 (tier retained), then demotes on run 2 once grace has itself lapsed', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    h.state.businesses.set(
      'biz-1',
      makeBiz({ businessId: 'biz-1', tier: 'pro', paidUntil: new Date(nowMs - DAY_MS).toISOString() }),
    )

    // Run 1: phase 1 sets grace, phase 2 finds nothing to demote (grace fresh).
    await startLapseSweep(nowMs)
    const demotedRun1 = await enforceLapsedPayments(nowMs)

    const afterGrace = h.state.businesses.get('biz-1')!
    expect(afterGrace.paymentGraceUntil).toBe(new Date(nowMs + SUBSCRIPTION_GRACE_DAYS * DAY_MS).toISOString())
    // R3.2: tier retained while grace is active — not demoted this run.
    expect(afterGrace.tier).toBe('pro')
    expect(afterGrace.isActive).toBe(true)
    expect(demotedRun1.processed).toBe(0)

    // Run 2: advance past the grace window; phase 2 demotes.
    const laterMs = nowMs + (SUBSCRIPTION_GRACE_DAYS + 1) * DAY_MS
    const demotedRun2 = await enforceLapsedPayments(laterMs)

    expect(demotedRun2.processed).toBe(1)
    const demoted = h.state.businesses.get('biz-1')!
    expect(demoted.tier).toBe('free')
    expect(demoted.isActive).toBe(false)
    expect(demoted.paymentGraceUntil).toBeNull()
    expect(h.deactivateNodesForBusiness).toHaveBeenCalledWith('biz-1')

    // R2.3: the demotion writes a system-actor audit entry so admin can answer
    // "why did this venue leave the map".
    expect(h.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'system:lapse-sweep',
        action: 'deactivate_for_non_payment',
        entityType: 'business',
        entityId: 'biz-1',
        afterState: expect.objectContaining({ tier: 'free' }),
      }),
    )
  })
})
