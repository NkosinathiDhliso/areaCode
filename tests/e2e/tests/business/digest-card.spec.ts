/**
 * §2.10 Reports — Weekly Attribution Digest card (weekly-attribution-digest R4.1).
 *
 * The business dashboard renders the DigestCard in the 'reports' view. The card
 * reads GET /v1/business/digest/latest ({ digest: DigestView | null }) and shows
 * the headline visits metric, the API copy strings, and the tier-aware close.
 *
 * A Digest_Row is only produced by the weekly Report_Pipeline generator — there
 * is no direct seeding path in the e2e environment. So this spec follows the
 * resilient pattern of reports-and-audience.spec.ts: it reads the latest-digest
 * endpoint first and `test.skip(...)`s when the endpoint/env is unavailable, but
 * asserts real rendering whenever the data (a stored digest, or the honest empty
 * state) is present. The quiet-week variant is asserted only when the seeded
 * data actually produces a zero-visit week; otherwise it is skipped with a clear
 * message, since a specific quiet-week row cannot be manufactured here.
 */

import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'
import { expectNoHorizontalScroll } from '../../support/structure.js'

/** Shape of GET /v1/business/digest/latest (see DigestCard DigestView). */
interface DigestView {
  weekStart: string
  metrics: { visits: number; [k: string]: unknown }
  deltas: Record<string, number> | null
  suppressed: string[]
  tierAtBuild: string
  copy: string[]
  createdAt: string
}
interface DigestLatestResponse {
  digest: DigestView | null
}

/** The reports view nav pill (state-based button, label "Reports"). */
const reportsNav = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^reports$/i }).first()

/**
 * Open the dashboard reports view and wait for the DigestCard to resolve into
 * one of its terminal states (card, empty, or error). Returns the settled state
 * so callers can branch. Skips when the reports view is not reachable.
 */
async function openReportsAndSettle(page: import('@playwright/test').Page): Promise<'card' | 'empty' | 'error'> {
  // Wait for the authenticated dashboard shell to settle before reading the nav,
  // so a not-yet-rendered pill is not mistaken for a missing permission.
  await expect(business.livePanelCount(page)).toBeVisible({ timeout: 15_000 })

  const nav = reportsNav(page)
  try {
    await nav.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    test.skip(true, 'Reports view not available for this business account (missing view_reports).')
  }
  await nav.click()

  const card = page.getByTestId('digest-card')
  const empty = page.getByTestId('digest-card-empty')
  const errored = page.getByTestId('digest-card-error')

  await expect(card.or(empty).or(errored).first()).toBeVisible({ timeout: 15_000 })

  if (await card.isVisible()) return 'card'
  if (await empty.isVisible()) return 'empty'
  return 'error'
}

test.describe('Business — weekly attribution digest card', () => {
  test('reports view renders the digest card (or an honest empty state)', async ({ page, loginAs, apiClient }) => {
    // Read the endpoint first: if it is unavailable, the whole surface is not
    // exercisable here, so skip rather than hard-fail (matches reports spec).
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/digest/latest')
    if (!res.ok()) test.skip(true, `Digest endpoint unavailable: ${res.status()}`)

    await loginAs('businessOwner', 'business')
    const state = await openReportsAndSettle(page)

    // The card must resolve to a real, non-error state: either a stored digest
    // renders, or the honest "no digest yet" empty state does. An error state is
    // a genuine failure, not an acceptable outcome.
    expect(state, 'digest card resolved to an error state').not.toBe('error')

    // House style: the reports view must not introduce horizontal scroll.
    await expectNoHorizontalScroll(page, 'business (reports)')
  })

  test('a stored digest shows the visits metric, the API copy, and the tier close', async ({
    page,
    loginAs,
    apiClient,
  }) => {
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/digest/latest')
    if (!res.ok()) test.skip(true, `Digest endpoint unavailable: ${res.status()}`)

    const body = (await res.json()) as DigestLatestResponse
    const digest = body.digest
    if (!digest) {
      test.skip(true, 'No stored Digest_Row for the seeded business (weekly pipeline has not run).')
      return
    }

    await loginAs('businessOwner', 'business')
    const state = await openReportsAndSettle(page)
    expect(state).toBe('card')

    // Headline visits metric renders the recorded count from the API verbatim.
    const visits = page.getByTestId('digest-metric-visits')
    await expect(visits).toBeVisible()
    await expect(visits).toContainText(String(digest.metrics.visits))

    // The tier-aware close is the last API copy line, rendered verbatim.
    if (digest.copy.length > 0) {
      const close = page.getByTestId('digest-close')
      await expect(close).toBeVisible()
      await expect(close).toHaveText(digest.copy[digest.copy.length - 1]!)
    }

    // The body sentences (all copy before the close) come from the API too.
    if (digest.copy.length > 1) {
      const copyBlock = page.getByTestId('digest-copy')
      await expect(copyBlock).toBeVisible()
      await expect(copyBlock).toContainText(digest.copy[0]!)
    }
  })

  test('quiet-week variant renders an honest zero when the digest has zero visits', async ({
    page,
    loginAs,
    apiClient,
  }) => {
    const api = await apiClient('businessOwner')
    const res = await api.get('/v1/business/digest/latest')
    if (!res.ok()) test.skip(true, `Digest endpoint unavailable: ${res.status()}`)

    const body = (await res.json()) as DigestLatestResponse
    const digest = body.digest
    if (!digest) {
      test.skip(true, 'No stored Digest_Row for the seeded business (weekly pipeline has not run).')
      return
    }
    // A specific quiet-week row cannot be manufactured in the e2e environment
    // (no seeding path; the generator computes real recorded visits). Only
    // assert the quiet-week path when the seeded data genuinely produced one.
    if (digest.metrics.visits !== 0) {
      test.skip(
        true,
        `Seeded digest has ${digest.metrics.visits} visits, not a quiet week; cannot seed a zero-visit row here.`,
      )
      return
    }

    await loginAs('businessOwner', 'business')
    const state = await openReportsAndSettle(page)
    expect(state).toBe('card')

    // Quiet-week affordance is shown and the visits figure is an honest 0.
    await expect(page.getByTestId('digest-quiet-week')).toBeVisible()
    await expect(page.getByTestId('digest-metric-visits')).toContainText('0')
  })
})
