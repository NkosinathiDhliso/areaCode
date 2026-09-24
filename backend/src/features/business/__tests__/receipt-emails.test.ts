/**
 * The Receipt in the trial and renewal emails (proof-of-demand R6.1, R6.3, R6.4).
 *
 * **Validates: Requirements 6.1, 6.3, 6.4**
 *
 * Both reminder sends run end to end: the real worker
 * (`handleTrialReminders`), the real service resolution
 * (`getReceiptEmailLines` -> `resolveReceiptWindow` -> `computeReceipt` ->
 * `buildReceiptCopy`) and the real SES renderer. Only DynamoDB, the check-in
 * read and the SESv2 client are mocked, so what is covered is what the owner
 * actually receives:
 *
 *   - the trial reminder at 3 days and at 1 day carries the trial-window
 *     Found_You sentence and the Walk_In line (R6.1);
 *   - a zero-Found_You window leads with the plain statement and the
 *     Onboarding_Checklist step that is actually missing, never "0 people found
 *     you" (R6.3);
 *   - the pre-lapse renewal reminder carries the paid-period Receipt (R6.4);
 *   - every email closes on exactly one CTA, and no sentence uses a causal verb
 *     (the same `BANNED_CAUSAL_VERBS` list the digest copy test quantifies over).
 *
 * Runs under the standard `pnpm test` (default node env).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mutable mock state ──────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  interface RepoCheckIn {
    userId: string
    checkedInAt: string
    foundVia?: string
  }

  const state = {
    business: {} as Record<string, unknown>,
    nodes: [{ nodeId: 'node-a', cityId: 'city-1', qrCheckinEnabled: true }] as Array<Record<string, unknown>>,
    payments: [] as Array<{ paidAt: string }>,
    checkIns: [] as RepoCheckIn[],
    renewalRows: [] as Array<{
      businessId: string
      email: string
      businessName: string
      paidUntil: string
      paidInterval: string
    }>,
  }

  const sesSendMock = vi.fn(async (..._args: unknown[]) => ({}))

  const dbSendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name
    const input = cmd.input ?? {}
    // The trial worker's scan over businesses with an active trial. Any other
    // scan (the rewards read behind the checklist) is genuinely empty here.
    if (name === 'ScanCommand') {
      const filter = String(input['FilterExpression'] ?? '')
      return { Items: filter.includes('trialEndsAt') ? [state.business] : [] }
    }
    // The business's nodes (receipt window read and the onboarding checklist).
    if (name === 'QueryCommand' && input['IndexName'] === 'BusinessIndex') return { Items: state.nodes }
    return { Items: [] }
  })

  return {
    state,
    sesSendMock,
    dbSendMock,
    getCheckInsByNodeMock: vi.fn(async () => ({ checkIns: state.checkIns })),
    querySubscriptionPaymentsMock: vi.fn(async () => ({ items: state.payments, nextCursor: null })),
    getBusinessByIdMock: vi.fn(async (id: string) => (id === 'biz-1' ? state.business : null)),
    listBusinessesForRenewalReminderMock: vi.fn(async () => state.renewalRows),
    setRenewalReminderSentMock: vi.fn(async () => ({})),
  }
})

// Capture the SendEmailCommand input; the renderer in `shared/email/ses.ts` is real.
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    send = h.sesSendMock
  },
  SendEmailCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}))

// DEV_MODE off: the production read paths must run, not the fixtures.
vi.mock('../../../shared/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/config/env.js')>()
  return { ...actual, DEV_MODE: false }
})

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.dbSendMock } }
})

vi.mock('../../check-in/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../check-in/dynamodb-repository.js')>()
  return { ...actual, getCheckInsByNode: h.getCheckInsByNodeMock }
})

vi.mock('../../auth/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/dynamodb-repository.js')>()
  return { ...actual, getBusinessById: h.getBusinessByIdMock }
})

vi.mock('../repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repository.js')>()
  return {
    ...actual,
    querySubscriptionPaymentsForBusiness: h.querySubscriptionPaymentsMock,
    listBusinessesForRenewalReminder: h.listBusinessesForRenewalReminderMock,
    setRenewalReminderSent: h.setRenewalReminderSentMock,
  }
})

import { BANNED_CAUSAL_VERBS } from '../../reports/digest.js'
import { sendRenewalReminders } from '../service.js'
import { handleTrialReminders } from '../trial-reminder.js'

// ─── Harness ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const CTA_URL = 'https://business.areacode.co.za/plans'

interface SimpleContent {
  Subject: { Data: string }
  Body: { Text: { Data: string }; Html: { Data: string } }
}

function lastEmail(): { to: string; subject: string; text: string; html: string } {
  const cmd = h.sesSendMock.mock.calls.at(-1)![0] as { input: Record<string, unknown> }
  const simple = (cmd.input['Content'] as { Simple: SimpleContent }).Simple
  return {
    to: (cmd.input['Destination'] as { ToAddresses: string[] }).ToAddresses[0]!,
    subject: simple.Subject.Data,
    text: simple.Body.Text.Data,
    html: simple.Body.Html.Data,
  }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** Every honesty rule that holds for any Receipt-carrying lifecycle email. */
function expectHonestSingleCtaEmail(): void {
  const { subject, text, html } = lastEmail()
  const body = `${subject}\n${text}\n${html}`
  for (const verb of BANNED_CAUSAL_VERBS) {
    expect(body.toLowerCase()).not.toContain(verb)
  }
  expect(body).not.toMatch(/revenue|ticket|spend|will arrive/i)
  // House style: no em dashes, no emoji in owner-facing copy.
  expect(body).not.toContain('\u2014')
  // Exactly one CTA: one Plans-panel link in the text, one anchor in the HTML.
  expect(occurrences(text, CTA_URL)).toBe(1)
  expect(occurrences(html, '<a href=')).toBe(1)
}

/** Check-ins inside the window, `foundVia` stamped where a source is given. */
function checkInRows(pairs: Array<[string, string | undefined]>, agoDays: number) {
  return pairs.map(([userId, foundVia], i) => ({
    userId,
    checkedInAt: new Date(Date.now() - agoDays * DAY_MS + i * 60_000).toISOString(),
    ...(foundVia === undefined ? {} : { foundVia }),
  }))
}

const FIVE_FOUND_YOU: Array<[string, string | undefined]> = [
  ['u1', 'map'],
  ['u2', 'map'],
  ['u3', 'share'],
  ['u4', 'search'],
  ['u5', 'push'],
  ['u6', undefined],
  ['u7', undefined],
]

/** A business whose trial ends in `daysLeft` days, matching the worker's date keys. */
function trialBusiness(daysLeft: number): Record<string, unknown> {
  return {
    businessId: 'biz-1',
    email: 'owner@venue.co.za',
    businessName: 'The Grand Cafe',
    tier: 'growth',
    trialEndsAt: new Date(Date.now() + daysLeft * DAY_MS).toISOString(),
    paidUntil: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.business = trialBusiness(3)
  h.state.nodes = [{ nodeId: 'node-a', cityId: 'city-1', qrCheckinEnabled: true }]
  h.state.payments = []
  h.state.checkIns = []
  h.state.renewalRows = []
})

// ─── Trial reminders (R6.1, R6.3) ────────────────────────────────────────────

describe('trial reminder carries the trial-window Receipt (R6.1)', () => {
  it.each([3, 1])('the %i-day reminder leads with the Found_You sentence', async (daysLeft) => {
    h.state.business = trialBusiness(daysLeft)
    h.state.checkIns = checkInRows(FIVE_FOUND_YOU, 2)

    const result = await handleTrialReminders()

    expect(result.sent).toBe(1)
    const { to, subject, text, html } = lastEmail()
    expect(to).toBe('owner@venue.co.za')
    expect(subject).toContain(`${daysLeft} day`)
    expect(text).toContain('5 people found you on Area Code and checked in during your trial.')
    expect(text).toContain('already in the room')
    // The HTML body renders the same sentences, escaped.
    expect(html).toContain('5 people found you on Area Code and checked in during your trial.')
    expect(html).toContain('The Grand Cafe')
    expectHonestSingleCtaEmail()
  })

  it('states how many days are left alongside the Receipt', async () => {
    h.state.checkIns = checkInRows(FIVE_FOUND_YOU, 2)

    await handleTrialReminders()

    const { text } = lastEmail()
    expect(text).toContain('Your free trial ends in 3 days.')
    // Receipt first, decision second: the measured fact precedes the ask.
    expect(text.indexOf('found you on Area Code')).toBeLessThan(text.indexOf('Your free trial ends'))
  })

  it('names the recorded sources once the split clears the floor', async () => {
    h.state.checkIns = checkInRows(FIVE_FOUND_YOU, 2)

    await handleTrialReminders()

    expect(lastEmail().text).toContain('Recorded sources:')
  })

  it('sends nothing on a day that is neither reminder', async () => {
    h.state.business = trialBusiness(9)

    const result = await handleTrialReminders()

    expect(result.sent).toBe(0)
    expect(h.sesSendMock).not.toHaveBeenCalled()
  })
})

describe('a zero-Found_You trial reads as the missing checklist step (R6.3)', () => {
  it('never reports a zero headline and offers exactly one next step', async () => {
    // No check-ins at all. The business has a node with QR on, no reward and no
    // staff, so the step the copy points at is the get.
    h.state.checkIns = []

    await handleTrialReminders()

    const { text } = lastEmail()
    expect(text).toContain('No one has found you on Area Code and checked in during your trial yet.')
    expect(text).not.toMatch(/\b0 people\b/)
    expect(text).toContain('Publish one get so a first-timer has a reason to walk in.')
    expectHonestSingleCtaEmail()
  })

  it('points at the venue step when the business has no venue yet', async () => {
    h.state.nodes = []
    h.state.checkIns = []

    await handleTrialReminders()

    expect(lastEmail().text).toContain('Add your venue so it appears on the map.')
  })

  it('still sends, saying less, when the business has no trial window on record', async () => {
    h.state.business = { ...trialBusiness(3), trialEndsAt: new Date(Date.now() + 3 * DAY_MS).toISOString() }
    h.state.checkIns = checkInRows(FIVE_FOUND_YOU, 2)
    // The receipt resolution reads the business row; an unknown business has no
    // window on record, so the reminder carries no Receipt rather than a guess.
    h.getBusinessByIdMock.mockResolvedValueOnce(null)

    const result = await handleTrialReminders()

    expect(result.sent).toBe(1)
    const { text } = lastEmail()
    expect(text).not.toContain('found you on Area Code')
    expect(text).toContain('Your free trial ends in 3 days.')
    expectHonestSingleCtaEmail()
  })
})

// ─── Renewal reminder (R6.4) ─────────────────────────────────────────────────

describe('pre-lapse renewal reminder carries the paid-period Receipt (R6.4)', () => {
  beforeEach(() => {
    const paidUntil = new Date(Date.now() + 3 * DAY_MS).toISOString()
    h.state.business = {
      businessId: 'biz-1',
      email: 'owner@venue.co.za',
      businessName: 'The Grand Cafe',
      tier: 'growth',
      trialEndsAt: null,
      paidUntil,
    }
    h.state.payments = [{ paidAt: new Date(Date.now() - 25 * DAY_MS).toISOString() }]
    h.state.renewalRows = [
      {
        businessId: 'biz-1',
        email: 'owner@venue.co.za',
        businessName: 'The Grand Cafe',
        paidUntil,
        paidInterval: 'monthly',
      },
    ]
  })

  it('leads with the Found_You sentence for the paid period', async () => {
    h.state.checkIns = checkInRows(FIVE_FOUND_YOU, 2)

    const result = await sendRenewalReminders()

    expect(result.reminded).toBe(1)
    const { text, html } = lastEmail()
    expect(text).toContain('5 people found you on Area Code and checked in during your paid period.')
    expect(text).toContain('already in the room')
    expect(text).toContain('Your Area Code subscription expires in 3 days.')
    expect(html).toContain('during your paid period')
    expectHonestSingleCtaEmail()
  })

  it('uses the checklist step when the paid period recorded no Found_You', async () => {
    h.state.checkIns = []

    await sendRenewalReminders()

    const { text } = lastEmail()
    expect(text).toContain('No one has found you on Area Code and checked in during your paid period yet.')
    expect(text).toContain('Publish one get so a first-timer has a reason to walk in.')
    expectHonestSingleCtaEmail()
  })

  it('still sends when no paid period is on record, without inventing one', async () => {
    h.state.payments = []
    h.state.checkIns = checkInRows(FIVE_FOUND_YOU, 2)

    const result = await sendRenewalReminders()

    expect(result.reminded).toBe(1)
    const { text } = lastEmail()
    expect(text).not.toContain('found you on Area Code')
    expect(text).toContain('Your Area Code subscription expires in 3 days.')
    expectHonestSingleCtaEmail()
  })
})
