/**
 * billing-revenue-integrity §16.1 — end-to-end billing sweep (deterministic part).
 *
 * Covers the Plans/billing panel surface that can be exercised without a live
 * Yoco card flow:
 *   1. The plans panel renders (plan cards + billing status area), resilient to
 *      whichever real billing state the seeded business is in (trial vs starter).
 *   2. The cancelled checkout-return path shows its truthful message.
 *   3. The failed checkout-return path shows its truthful message.
 *
 * The return status is read by PlansPanel (useCheckoutReturn) from
 * window.location.search on mount, so we mock it purely via the URL param — no
 * network stubbing needed. These branches are deterministic from the URL.
 *
 * The success poll path hits GET /v1/business/me repeatedly, so it is a manual
 * check (see the launch-morning gate, task 16.2) rather than a URL-mockable one.
 */

import { URLS } from '../../support/env.js'
import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'

// Copy asserted against, from CheckoutReturnBanner.tsx. Matched as
// case-insensitive substrings so a minor wording tweak does not break the test.
const CANCELLED_COPY = /checkout cancelled\.\s*no payment was taken/i
const FAILED_COPY = /did not go through and no charge was made/i

// Navigates to the business dashboard carrying a checkout-return status param,
// then opens the Plans tab so PlansPanel mounts and reads the param. Assumes an
// authenticated session (call after loginAs).
async function openPlansWithStatus(page: import('@playwright/test').Page, status?: string): Promise<void> {
  const url = new URL(URLS.business())
  if (status) url.searchParams.set('status', status)
  await page.goto(url.toString())
  await business.plansNav(page).click()
  await expect(business.plansTitle(page)).toBeVisible({ timeout: 15_000 })
}

test.describe('Business — billing states & checkout returns', () => {
  test('plans panel renders billing state and plan cards', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await openPlansWithStatus(page)

    // Plan cards always render once /v1/business/plans resolves. Assert the
    // tier names appear — resilient across trial/starter/paid billing states.
    await expect(page.getByText(/starter/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/growth/i).first()).toBeVisible()
    await expect(page.getByText(/\bpro\b/i).first()).toBeVisible()

    // The billing status area reflects whatever real state the seeded business
    // is in: a trial countdown, a paid/grace window, an expired-trial note, or
    // (for a fresh starter with no trial) the per-card "current plan" marker.
    // Assert that at least one of those honest states is present, without
    // pinning to a specific one.
    const billingState = page
      .getByText(/free trial active/i)
      .or(page.getByText(/paid until/i))
      .or(page.getByText(/payment overdue/i))
      .or(page.getByText(/trial has ended/i))
      .or(page.getByText(/current plan/i))
      .first()
    await expect(billingState).toBeVisible({ timeout: 15_000 })
  })

  test('cancelled return path shows the cancelled message', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await openPlansWithStatus(page, 'cancelled')

    await expect(page.getByText(CANCELLED_COPY).first()).toBeVisible({ timeout: 10_000 })
  })

  test('failed return path shows the failed message', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await openPlansWithStatus(page, 'failed')

    await expect(page.getByText(FAILED_COPY).first()).toBeVisible({ timeout: 10_000 })
  })

  // The success return polls GET /v1/business/me until the paid window lands,
  // which needs a real (or webhook-simulated) activation. Verified manually on
  // the launch-morning gate (task 16.2), not from a URL param.
  test.fixme('success return path confirms the activated plan (manual / launch gate)', async () => {
    // Requires Yoco test-mode checkout + webhook to flip tier + paidUntil.
  })
})
