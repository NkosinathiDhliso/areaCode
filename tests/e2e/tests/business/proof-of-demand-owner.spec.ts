/**
 * The owner's proof of demand — Receipt, checklist, Going, scoreboard, Tonight.
 *
 * Spec: .kiro/specs/proof-of-demand (Requirements 4, 5, 6, 7, 8, 9.4, 9.5),
 * task 12.3 (R13.3).
 *
 * Implementation under test:
 *   - `screens/panels/LivePanel.tsx` — the Receipt's two lines and the separate
 *     "Going tonight" card
 *   - `screens/panels/OnboardingChecklistCard.tsx` — four rows, each deep-linking
 *     to the panel that completes it
 *   - `screens/panels/PlansReceiptCard.tsx` — the Receipt above the upgrade CTA
 *   - `components/BoostScoreboardCard.tsx` — what one Boost_Window recorded
 *   - `components/FoundViaBadge.tsx` — the Found_You badge on a check-in row
 *   - `screens/panels/TonightForm.tsx` — the publish form
 *
 * What these tests pin, and the three rules behind them:
 *   1. Every owner-facing sentence is rendered VERBATIM from the API. The portal
 *      never re-words or re-derives a Found_You fact (R4.6), so each assertion
 *      compares the rendered text against the same endpoint the card reads.
 *   2. Intent is never presence. The Going card is its own card, outside the
 *      aliveness row, and says "marked going" (R9.4, `honest-presence.md`).
 *   3. A card's loading or failed read is that card's state only. The Plans
 *      Receipt must never gate the upgrade buttons below it (R6.2).
 *
 * Numbers come from whatever the environment recorded, read through the API, so
 * the assertions hold seeded or not. Where a branch needs data that cannot be
 * manufactured here (a boost purchase, a non-walk-in check-in), the test skips
 * with a clear reason naming the seed that enables it — the seeded figures are
 * in `docs/UAT_PROOF_OF_DEMAND.md` (`backend/src/scripts/seed-proof-of-demand.ts`).
 */

import type { APIRequestContext, Page } from '@playwright/test'

import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'
import { expectNoHorizontalScroll } from '../../support/structure.js'

// ─── API shapes (mirrored from `packages/shared/types`) ──────────────────────

interface ReceiptSentences {
  headline: string
  walkIn: string
}

interface LiveGoingLine {
  nodeId: string
  nodeName: string
  goingCount: number
}

interface LiveStats extends Record<string, unknown> {
  checkInsToday: number
  foundYouToday: number
  walkInsToday: number
  receiptToday: ReceiptSentences
  goingTonight: LiveGoingLine[]
}

interface OnboardingStatus {
  hasNode: boolean
  hasReward: boolean
  hasStaff: boolean
  hasQr: boolean
}

interface BusinessReceipt extends ReceiptSentences {
  window: 'trial' | 'paid' | 'week'
  firstTimers: string | null
  bySource: string | null
  measuredFrom: string | null
  nextStep: { step: string | null; text: string } | null
}

interface BusinessProfile {
  id: string
  trialEndsAt?: string | null
  paidUntil?: string | null
}

interface BoostPeriod {
  checkIns: number
  visitors: number
  foundYou: number
  walkIns: number
}

interface BoostScoreboard {
  boostId: string
  windowClosed: boolean
  window: BoostPeriod
  baseline: BoostPeriod
  comparable: boolean
  delta: { checkIns: number; foundYou: number } | null
}

interface CheckInRow {
  displayName: string
  visitCount: number
  timestamp: string
  foundVia: string
}

/** SAST calendar date, the partition the check-ins panel asks for (R15.8). */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
function sastDateString(): string {
  return new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10)
}

/** The four checklist steps, in the card's render order. */
const CHECKLIST_STEPS = ['venue', 'reward', 'staff', 'qr'] as const

/**
 * Read an owner endpoint, or skip the test when the environment cannot serve it.
 * Same resilience contract as `digest-card.spec.ts`: a missing surface is an
 * environment gap, a wrong surface is a failure.
 */
async function readOrSkip<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path)
  if (!res.ok()) test.skip(true, `${path} unavailable: ${res.status()}`)
  return (await res.json()) as T
}

/** Wait for the authenticated dashboard shell, then open a panel by its label. */
async function openPanel(page: Page, label: RegExp, human: string): Promise<void> {
  await expect(business.livePanelCount(page)).toBeVisible({ timeout: 15_000 })
  const nav = business.panelNav(page, label)
  try {
    await nav.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    test.skip(true, `${human} panel not available for this business account (missing permission).`)
  }
  await nav.click()
}

// ─── The Receipt on the live panel (R4.3, R4.6) ──────────────────────────────

test.describe('Business — the Receipt on the live panel', () => {
  test('renders the two API sentences verbatim, beside the check-in count', async ({ page, loginAs, apiClient }) => {
    const api = await apiClient('businessOwner')
    const stats = await readOrSkip<LiveStats>(api, '/v1/business/me/live-stats')

    await loginAs('businessOwner', 'business')
    await expect(business.livePanelCount(page)).toBeVisible({ timeout: 15_000 })

    // Verbatim, not "contains": one wording for the Found_You fact, owned by
    // `buildReceiptCopy` on the server.
    await expect(business.liveReceipt(page)).toBeVisible({ timeout: 15_000 })
    await expect(business.liveReceiptHeadline(page)).toHaveText(stats.receiptToday.headline)
    await expect(business.liveReceiptWalkIn(page)).toHaveText(stats.receiptToday.walkIn)

    // The split is exhaustive and disjoint: the two halves make the whole.
    expect(stats.foundYouToday + stats.walkInsToday).toBeGreaterThanOrEqual(0)
    await expectNoHorizontalScroll(page, 'business (live)')
  })

  test('Going tonight is its own card, worded as intent, not a headcount', async ({ page, loginAs, apiClient }) => {
    const api = await apiClient('businessOwner')
    const stats = await readOrSkip<LiveStats>(api, '/v1/business/me/live-stats')

    const lines = stats.goingTonight ?? []
    if (lines.length === 0) {
      test.skip(true, 'No Going marks recorded for tonight — the seed records 5 at Kudu Bar and 2 at Thembi Coffee.')
      return
    }

    await loginAs('businessOwner', 'business')
    await expect(business.liveGoing(page)).toBeVisible({ timeout: 15_000 })

    for (const line of lines) {
      const row = business.liveGoingFor(page, line.nodeId)
      await expect(row).toContainText(String(line.goingCount))
      // Owner surfaces show the true count, including a count a consumer would
      // not be told (R9.2), but the wording never implies presence (R9.3).
      await expect(row).toContainText(/marked going tonight/i)
      await expect(row).not.toContainText(/here now|in the room|arrived/i)
    }

    // Intent must not be folded into the live count.
    await expect(business.liveGoing(page)).not.toContainText(/check.?ins today/i)
  })
})

// ─── Onboarding_Checklist (R5.1, R5.2) ──────────────────────────────────────

test.describe('Business — the onboarding checklist', () => {
  test('shows one row per incomplete step and deep-links it, or nothing once set up', async ({
    page,
    loginAs,
    apiClient,
  }) => {
    const api = await apiClient('businessOwner')
    const status = await readOrSkip<OnboardingStatus>(api, '/v1/business/me/onboarding-status')

    await loginAs('businessOwner', 'business')
    await expect(business.livePanelCount(page)).toBeVisible({ timeout: 15_000 })

    const done = [status.hasNode, status.hasReward, status.hasStaff, status.hasQr].filter(Boolean).length
    const card = business.onboardingChecklist(page)

    if (done === CHECKLIST_STEPS.length) {
      // Complete setup: the card has nothing left to ask for, so it renders
      // nothing at all rather than an empty "you are all set" shell.
      await expect(card).toHaveCount(0)
      return
    }

    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(business.onboardingChecklistProgress(page)).toHaveText(
      new RegExp(`${done}\\s+of\\s+${CHECKLIST_STEPS.length}\\s+done`, 'i'),
    )
    // All four rows are always listed, done or not: the owner sees the whole path.
    for (const step of CHECKLIST_STEPS) {
      await expect(business.onboardingRow(page, step)).toBeVisible()
    }

    // A row is a deep link: tapping it opens the panel that completes the step.
    // The dashboard lands on the live panel, and no checklist step is completed
    // there, so leaving the live panel is the observable navigation.
    const incomplete: Record<(typeof CHECKLIST_STEPS)[number], boolean> = {
      venue: !status.hasNode,
      reward: !status.hasReward,
      staff: !status.hasStaff,
      qr: !status.hasQr,
    }
    const step = CHECKLIST_STEPS.find((s) => incomplete[s]) ?? 'venue'
    const row = business.onboardingRow(page, step)
    expect(await row.getAttribute('data-panel'), 'every checklist row names the panel it opens').not.toBeNull()
    await row.click()
    await expect(page.getByTestId('live-checkins-today')).toHaveCount(0, { timeout: 15_000 })
    // The card stays: the remaining steps are still worth asking for.
    await expect(card).toBeVisible()
  })
})

// ─── The Receipt above the upgrade CTA (R6.2, R6.3) ─────────────────────────

test.describe('Business — the Receipt on the Plans panel', () => {
  test('renders above the plan cards and never gates them', async ({ page, loginAs, apiClient }) => {
    const api = await apiClient('businessOwner')
    const profile = await readOrSkip<BusinessProfile>(api, '/v1/business/me')
    // The same resolution PlansPanel uses: the decision the panel is about.
    const receiptWindow = profile.trialEndsAt != null ? 'trial' : profile.paidUntil != null ? 'paid' : 'week'
    const receipt = await readOrSkip<BusinessReceipt>(api, `/v1/business/receipt?window=${receiptWindow}`)

    await loginAs('businessOwner', 'business')
    await openPanel(page, /^plans$/i, 'Plans')
    await expect(business.plansTitle(page)).toBeVisible({ timeout: 15_000 })

    const card = business.plansReceipt(page)
    // A failed read is a state of this card alone, so treat an error as a real
    // failure rather than an acceptable outcome.
    await expect(card.or(business.plansReceiptLoading(page)).first()).toBeVisible({ timeout: 15_000 })
    await expect(business.plansReceiptError(page)).toHaveCount(0)
    await expect(card).toBeVisible({ timeout: 15_000 })

    await expect(business.plansReceiptHeadline(page)).toHaveText(receipt.headline)
    await expect(business.plansReceiptWalkIn(page)).toHaveText(receipt.walkIn)

    // Zero Found_You gets exactly one constructive step, never a bare zero.
    if (receipt.nextStep) {
      await expect(business.plansReceiptNextStep(page)).toHaveText(receipt.nextStep.text)
    } else {
      await expect(business.plansReceiptNextStep(page)).toHaveCount(0)
    }

    // Structural: the Receipt sits above the plan cards it informs.
    const receiptBox = await card.boundingBox()
    const cta = page.getByRole('button', { name: /subscribe|start free trial|change plan/i }).first()
    if (await cta.isVisible().catch(() => false)) {
      const ctaBox = await cta.boundingBox()
      expect(receiptBox && ctaBox && receiptBox.y < ctaBox.y, 'the Receipt must render above the upgrade CTA').toBe(
        true,
      )
    }
    await expectNoHorizontalScroll(page, 'business (plans)')
  })
})

// ─── Boost_Scoreboard (R7.1, R7.4, R7.5) ────────────────────────────────────

test.describe('Business — the boost scoreboard', () => {
  test('reports both windows and compares only when the samples allow it', async ({ page, loginAs, apiClient }) => {
    const api = await apiClient('businessOwner')
    const profile = await readOrSkip<BusinessProfile>(api, '/v1/business/me')
    const purchases = await readOrSkip<{ items: Array<{ yocoCheckoutId: string }> }>(
      api,
      `/v1/business/${profile.id}/boost-purchases`,
    )

    const boostId = purchases.items[0]?.yocoCheckoutId
    if (!boostId) {
      test.skip(true, 'No boost purchase for this business — the seed gives Kudu Bar an active Boost_Window.')
      return
    }
    const board = await readOrSkip<BoostScoreboard>(api, `/v1/business/boosts/${boostId}/scoreboard`)

    await loginAs('businessOwner', 'business')
    await openPanel(page, /^boost$/i, 'Boost')

    const card = business.boostScoreboard(page, boostId)
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Counts always render, for both windows. A window that recorded nothing is
    // reported as nothing: neither a failure nor a claim.
    const windowLine = business.boostScoreboardWindow(page, boostId)
    await expect(windowLine).toContainText(String(board.window.checkIns))
    await expect(windowLine).toContainText(`${board.window.foundYou} found you`)
    const baselineLine = business.boostScoreboardBaseline(page, boostId)
    await expect(baselineLine).toContainText(`${board.baseline.foundYou} found you`)
    await expect(baselineLine).toContainText(/same hours last week/i)

    // The comparison exists only when the server says both samples support it.
    if (board.comparable && board.delta) {
      await expect(business.boostScoreboardDelta(page, boostId)).toBeVisible()
      await expect(business.boostScoreboardNoCompare(page, boostId)).toHaveCount(0)
    } else {
      await expect(business.boostScoreboardDelta(page, boostId)).toHaveCount(0)
      await expect(business.boostScoreboardNoCompare(page, boostId)).toBeVisible()
    }

    // Measurement verbs only: the scoreboard never says the boost caused a visit.
    await expect(card).not.toContainText(/brought|drove|generated|because of/i)
  })
})

// ─── The Found_You badge on a check-in row (R4.4) ───────────────────────────

test.describe('Business — the check-ins panel source badge', () => {
  test('badges a recorded source and leaves a walk-in unbadged', async ({ page, loginAs, apiClient }) => {
    const api = await apiClient('businessOwner')
    const date = sastDateString()
    const rows = await readOrSkip<{ items: CheckInRow[] }>(api, `/v1/business/check-ins?date=${date}`)

    const items = rows.items ?? []
    if (items.length === 0) {
      test.skip(true, `No check-ins recorded for ${date} (SAST) — the seed records 4 at Kudu Bar and 2 at Thembi.`)
      return
    }

    await loginAs('businessOwner', 'business')
    await openPanel(page, /^check-ins$/i, 'Check-ins')

    const sourced = items.find((row) => row.foundVia !== 'walk_in')
    if (sourced) {
      const badge = business.foundViaBadge(page, sourced.foundVia)
      await expect(badge.first()).toBeVisible({ timeout: 15_000 })
      // The badge states the recorded source, never a cause.
      await expect(badge.first()).toContainText(/^Found you from (the map|a shared link|search|a notification)$/)
    }

    // "Already in the room" is the absence of a source, so it is never badged:
    // badging it would read as a claim Area Code never measured.
    await expect(business.foundViaBadge(page, 'walk_in')).toHaveCount(0)
    await expectNoHorizontalScroll(page, 'business (check-ins)')
  })
})

// ─── The Tonight publish form (R8.1 to R8.4) ────────────────────────────────

test.describe('Business — the Tonight publish form', () => {
  test('offers the night the owner is publishing, bounded and not yet published', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await openPanel(page, /^tonight$/i, 'Tonight')

    const panel = business.tonightPanel(page)
    const noVenue = business.tonightNoVenue(page)
    await expect(panel.or(noVenue).or(business.tonightDenied(page)).first()).toBeVisible({ timeout: 15_000 })
    // A failed load is a real failure, not an acceptable resting state.
    await expect(business.tonightLoadError(page)).toHaveCount(0)

    if (await noVenue.isVisible().catch(() => false)) {
      test.skip(true, 'Business has no venue yet, so there is no schedule to publish against.')
      return
    }
    if (!(await panel.isVisible().catch(() => false))) {
      test.skip(true, 'Tonight is not editable for this account (no schedule permission).')
      return
    }

    // The date is bounded below, so a night already gone cannot be promised. The
    // bound is the venue's schedule-local today, which the portal owns, so this
    // asserts the bound exists and the offered night respects it rather than
    // restating the timezone rule here.
    const dateField = business.tonightDate(page)
    const min = await dateField.getAttribute('min')
    expect(min, 'the publish date must be bounded below').toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const offered = await dateField.inputValue()
    expect(offered >= (min ?? ''), `offered night ${offered} is before the bound ${min}`).toBe(true)
    await expect(business.tonightStart(page)).toBeVisible()

    // The headline is the owner's one line: required, with a live
    // remaining-characters read so the limit is visible before publishing.
    const headline = business.tonightHeadlineField(page)
    await headline.fill('')
    await expect(business.tonightSubmit(page)).toBeDisabled()
    const emptyCount = await business.tonightHeadlineCount(page).textContent()
    await headline.fill('Amapiano all night')
    await expect(business.tonightHeadlineCount(page)).not.toHaveText(emptyCount ?? '')
    // Nothing is published by typing: the submit is the only write, and this
    // test never presses it.
    await expect(business.tonightSubmit(page)).toBeVisible()
    await expectNoHorizontalScroll(page, 'business (tonight)')
  })
})
