/**
 * Renewal-reminder unit tests (billing-revenue-integrity task 6.2).
 *
 * Validates: Requirements 3.4
 *
 * Exercises `sendRenewalReminders` in the business service — the pre-lapse
 * renewal nudge composed into the daily trial-reminder worker:
 *
 *   - a paid monthly/yearly business whose `paidUntil` is within 7 days gets
 *     exactly one renewal-upcoming email, and its `renewalReminderSentFor` is
 *     stamped to that `paidUntil`;
 *   - `daily` / `weekly` payg windows never get a pre-lapse reminder (R3.4);
 *   - a window already outside the 7-day lead, or already lapsed, is skipped;
 *   - dedup: a second run in the same window does not re-email;
 *   - a renewal (a new, later `paidUntil`) re-arms the reminder.
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * Env is `dev` + `AREA_CODE_FORCE_LIVE` so DEV_MODE is off (the sweep runs) but
 * the Payment_Config_Guard stays lenient at import — the same pattern as
 * `lapse-sweep.test.ts`. The service is imported dynamically in `beforeAll`.
 *
 * `../repository.js` and the SES module are mocked with a stateful in-memory
 * business store that models the selection query
 * (`listBusinessesForRenewalReminder`, including its dedup filter) and the
 * `setRenewalReminderSent` marker write. `Date` is faked for determinism.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

const FIXED_NOW_ISO = '2026-03-15T10:00:00.000Z'
const DAY_MS = 24 * 60 * 60 * 1000

interface Biz {
  businessId: string
  email: string
  businessName: string
  tier: string
  paidUntil: string | null
  paidInterval: string | null
  renewalReminderSentFor: string | null
}

// ─── Stateful in-memory repository double ────────────────────────────────────

const h = vi.hoisted(() => {
  const state: { businesses: Map<string, Biz>; failEmailFor: Set<string> } = {
    businesses: new Map(),
    failEmailFor: new Set(),
  }

  const isPaid = (tier: string) => tier === 'growth' || tier === 'pro' || tier === 'payg'
  const isMonthlyOrYearly = (interval: string | null) => interval === 'monthly' || interval === 'yearly'

  // Mirrors the real filter (repository.listBusinessesForRenewalReminder): paid
  // tier, monthly/yearly interval, now < paidUntil <= windowEnd, and not already
  // reminded for this window (renewalReminderSentFor absent/null OR != paidUntil).
  const listBusinessesForRenewalReminder = vi.fn(async (nowIso: string, windowEndIso: string) => {
    const rows: Array<{
      businessId: string
      email: string
      businessName: string
      paidUntil: string
      paidInterval: string
    }> = []
    for (const b of state.businesses.values()) {
      const p = b.paidUntil
      if (typeof p !== 'string') continue
      const inWindow = p > nowIso && p <= windowEndIso
      const notReminded = b.renewalReminderSentFor === null || b.renewalReminderSentFor !== p
      if (isPaid(b.tier) && isMonthlyOrYearly(b.paidInterval) && inWindow && notReminded) {
        rows.push({
          businessId: b.businessId,
          email: b.email,
          businessName: b.businessName,
          paidUntil: p,
          paidInterval: b.paidInterval as string,
        })
      }
    }
    return rows
  })

  const setRenewalReminderSent = vi.fn(async (id: string, paidUntil: string) => {
    const b = state.businesses.get(id)
    if (b) b.renewalReminderSentFor = paidUntil
    return {}
  })

  const sendRenewalUpcomingEmail = vi.fn(async (to: string, _name: string, _daysLeft: number) => {
    // Address is the key we track failures on (matches `${businessId}@...`).
    const id = to.split('@')[0] ?? ''
    if (state.failEmailFor.has(id)) throw new Error(`email failed for ${id}`)
  })

  // startLapseSweep also imports this; unused here but must exist on the mock.
  const sendRenewalReminderEmail = vi.fn(async (_to: string, _name: string) => {})

  return {
    state,
    listBusinessesForRenewalReminder,
    setRenewalReminderSent,
    sendRenewalUpcomingEmail,
    sendRenewalReminderEmail,
  }
})

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    listBusinessesForRenewalReminder: h.listBusinessesForRenewalReminder,
    setRenewalReminderSent: h.setRenewalReminderSent,
  }
})

vi.mock('../../../shared/email/ses.js', () => ({
  sendRenewalUpcomingEmail: h.sendRenewalUpcomingEmail,
  sendRenewalReminderEmail: h.sendRenewalReminderEmail,
}))

let sendRenewalReminders: (typeof import('../service.js'))['sendRenewalReminders']

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  process.env['YOCO_WEBHOOK_SECRET'] = 'whsec_test'
  ;({ sendRenewalReminders } = await import('../service.js'))
})

function makeBiz(overrides: Partial<Biz> & { businessId: string }): Biz {
  return {
    email: `${overrides.businessId}@example.com`,
    businessName: `Biz ${overrides.businessId}`,
    tier: 'growth',
    paidUntil: null,
    paidInterval: 'monthly',
    renewalReminderSentFor: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FIXED_NOW_ISO))
  h.state.businesses.clear()
  h.state.failEmailFor.clear()
  h.listBusinessesForRenewalReminder.mockClear()
  h.setRenewalReminderSent.mockClear()
  h.sendRenewalUpcomingEmail.mockClear()
  h.sendRenewalReminderEmail.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sendRenewalReminders — selection and send (R3.4)', () => {
  it('sends exactly one email and stamps the marker for a monthly window within 7 days', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const paidUntil = new Date(nowMs + 3 * DAY_MS).toISOString()
    h.state.businesses.set('biz-1', makeBiz({ businessId: 'biz-1', paidInterval: 'monthly', paidUntil }))

    const result = await sendRenewalReminders(nowMs)

    expect(result.reminded).toBe(1)
    expect(h.sendRenewalUpcomingEmail).toHaveBeenCalledTimes(1)
    // 3 days left, ISO exact so ceil is 3.
    expect(h.sendRenewalUpcomingEmail).toHaveBeenCalledWith('biz-1@example.com', 'Biz biz-1', 3)
    expect(h.setRenewalReminderSent).toHaveBeenCalledWith('biz-1', paidUntil)
    expect(h.state.businesses.get('biz-1')!.renewalReminderSentFor).toBe(paidUntil)
  })

  it('sends for a yearly window within 7 days', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const paidUntil = new Date(nowMs + 6 * DAY_MS).toISOString()
    h.state.businesses.set('biz-year', makeBiz({ businessId: 'biz-year', paidInterval: 'yearly', paidUntil }))

    const result = await sendRenewalReminders(nowMs)

    expect(result.reminded).toBe(1)
    expect(h.sendRenewalUpcomingEmail).toHaveBeenCalledWith('biz-year@example.com', 'Biz biz-year', 6)
  })

  it('never sends a pre-lapse reminder for daily or weekly payg windows (R3.4)', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const soon = new Date(nowMs + 1 * DAY_MS).toISOString()
    h.state.businesses.set(
      'biz-daily',
      makeBiz({ businessId: 'biz-daily', tier: 'payg', paidInterval: 'daily', paidUntil: soon }),
    )
    h.state.businesses.set(
      'biz-weekly',
      makeBiz({ businessId: 'biz-weekly', tier: 'payg', paidInterval: 'weekly', paidUntil: soon }),
    )

    const result = await sendRenewalReminders(nowMs)

    expect(result.reminded).toBe(0)
    expect(h.sendRenewalUpcomingEmail).not.toHaveBeenCalled()
  })

  it('does not send when the window ends more than 7 days out', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const paidUntil = new Date(nowMs + 10 * DAY_MS).toISOString()
    h.state.businesses.set('biz-far', makeBiz({ businessId: 'biz-far', paidUntil }))

    const result = await sendRenewalReminders(nowMs)

    expect(result.reminded).toBe(0)
    expect(h.sendRenewalUpcomingEmail).not.toHaveBeenCalled()
  })

  it('does not send once the window has already lapsed (that is the Lapse_Sweep, not this)', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const paidUntil = new Date(nowMs - DAY_MS).toISOString()
    h.state.businesses.set('biz-lapsed', makeBiz({ businessId: 'biz-lapsed', paidUntil }))

    const result = await sendRenewalReminders(nowMs)

    expect(result.reminded).toBe(0)
    expect(h.sendRenewalUpcomingEmail).not.toHaveBeenCalled()
  })

  it('dedup: a second run in the same window does not re-email', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const paidUntil = new Date(nowMs + 4 * DAY_MS).toISOString()
    h.state.businesses.set('biz-1', makeBiz({ businessId: 'biz-1', paidUntil }))

    const first = await sendRenewalReminders(nowMs)
    const second = await sendRenewalReminders(nowMs)

    expect(first.reminded).toBe(1)
    expect(second.reminded).toBe(0)
    expect(h.sendRenewalUpcomingEmail).toHaveBeenCalledTimes(1)
  })

  it('re-arms after a renewal: a new, later paidUntil triggers a fresh reminder', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const firstWindow = new Date(nowMs + 2 * DAY_MS).toISOString()
    h.state.businesses.set('biz-1', makeBiz({ businessId: 'biz-1', paidUntil: firstWindow }))

    await sendRenewalReminders(nowMs)
    expect(h.sendRenewalUpcomingEmail).toHaveBeenCalledTimes(1)

    // Renewal extends the window: paidUntil changes, marker still points at the
    // old window, so the new window re-arms the reminder next time it is within
    // the 7-day lead.
    const laterNowMs = nowMs + 30 * DAY_MS
    const renewedWindow = new Date(laterNowMs + 5 * DAY_MS).toISOString()
    const biz = h.state.businesses.get('biz-1')!
    biz.paidUntil = renewedWindow

    const second = await sendRenewalReminders(laterNowMs)

    expect(second.reminded).toBe(1)
    expect(h.sendRenewalUpcomingEmail).toHaveBeenCalledTimes(2)
    expect(h.setRenewalReminderSent).toHaveBeenLastCalledWith('biz-1', renewedWindow)
  })

  it('logs and skips a per-business failure so one bad row never aborts the sweep', async () => {
    const nowMs = Date.parse(FIXED_NOW_ISO)
    const paidUntil = new Date(nowMs + 3 * DAY_MS).toISOString()
    h.state.businesses.set('bad', makeBiz({ businessId: 'bad', paidUntil }))
    h.state.businesses.set('good', makeBiz({ businessId: 'good', paidUntil }))
    h.state.failEmailFor.add('bad')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendRenewalReminders(nowMs)

    // 'good' still reminded despite 'bad' throwing on its email.
    expect(result.reminded).toBe(1)
    expect(h.setRenewalReminderSent).toHaveBeenCalledTimes(1)
    expect(h.setRenewalReminderSent).toHaveBeenCalledWith('good', paidUntil)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
