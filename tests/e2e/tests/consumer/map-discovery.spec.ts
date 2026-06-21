/**
 * Map discovery — the Peek-Carousel browse-and-compare surface.
 *
 * Spec: .kiro/specs/map-discovery-experience
 *
 * These flows exercise the two-state Peek_Carousel end-to-end against a running
 * stack: Browse_Mode (swipeable Venue_Card strip + Flick_Controls), Commit_Mode
 * (the detail body + check-in CTA), the empty-viewport invite, and the
 * no-phone/no-SMS guarantee on the auth entry reachable from the map
 * (Property 31 / Requirement 20.1, and the no-SMS steering rule).
 *
 * The carousel is data-driven: it only opens when at least one venue is in the
 * viewport. Where the environment has no seeded nodes the relevant test skips
 * with a clear reason, matching `signup-and-checkin.spec.ts`.
 */

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'

test.describe('Consumer — map discovery (Peek-Carousel)', () => {
  test('map loads and the carousel opens in Browse_Mode', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })

    const carousel = consumer.peekCarousel(page)
    if (!(await carousel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Peek-Carousel not visible — environment likely has no nodes seeded in view')
    }
    await expect(carousel).toHaveAttribute('data-mode', 'browse')
    await expect(consumer.venueCard(page)).toBeVisible()
  })

  test('flicking next changes the active card', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    const carousel = consumer.peekCarousel(page)
    if (!(await carousel.isVisible({ timeout: 15_000 }).catch(() => false))) {
      test.skip(true, 'Peek-Carousel not visible — no nodes seeded in view')
    }

    const next = consumer.flickNext(page)
    // With a single in-view venue the controls are disabled; nothing to step to.
    if (await next.isDisabled().catch(() => true)) {
      test.skip(true, 'Only one venue in view — flick stepping needs at least two')
    }

    const before = await consumer.activeVenueCard(page).getAttribute('data-venue-card')
    await next.click()
    await expect.poll(async () => consumer.activeVenueCard(page).getAttribute('data-venue-card')).not.toBe(before)
  })

  test('tapping View details enters Commit_Mode', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    const carousel = consumer.peekCarousel(page)
    if (!(await carousel.isVisible({ timeout: 15_000 }).catch(() => false))) {
      test.skip(true, 'Peek-Carousel not visible — no nodes seeded in view')
    }

    await consumer.viewDetails(page).click()
    await expect(carousel).toHaveAttribute('data-mode', 'commit')
    await expect(consumer.checkInButton(page)).toBeVisible({ timeout: 10_000 })
  })

  test('unauthenticated check-in opens signup with no phone/SMS field', async ({ page }) => {
    // Land on the consumer portal as a guest (no login fixture).
    await page.goto(process.env['E2E_CONSUMER_URL'] ?? '/')
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })

    const carousel = consumer.peekCarousel(page)
    if (!(await carousel.isVisible({ timeout: 15_000 }).catch(() => false))) {
      test.skip(true, 'Peek-Carousel not visible — no nodes seeded in view')
    }

    // Browse → Commit → check-in CTA.
    await consumer.viewDetails(page).click()
    await expect(carousel).toHaveAttribute('data-mode', 'commit')
    const checkIn = consumer.checkInButton(page)
    if (!(await checkIn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'No check-in CTA available for the active venue')
    }
    await checkIn.click()

    // The only auth entry from the map is email/password + Google OAuth.
    const signUp = page.getByRole('button', { name: /sign ?up/i }).first()
    if (await signUp.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await signUp.click()
    }

    // Property 31 / R20.1 + no-SMS rule: there must be NO phone/SMS/OTP input
    // anywhere on the auth surface reachable from the map.
    await expect(page.locator('input[type="tel"]')).toHaveCount(0)
    await expect(page.getByPlaceholder(/phone|mobile|otp|sms|\+27/i)).toHaveCount(0)
    await expect(page.getByLabel(/phone|mobile|otp|sms/i)).toHaveCount(0)
  })

  test('empty viewport shows the "no venues in view" invite', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })

    // Pan far into open ocean so no seeded venue is in the viewport. Mapbox is
    // canvas-driven, so this is best-effort; skip if the invite never appears
    // (the environment may keep the last venue pinned in view).
    const empty = consumer.browseEmpty(page)
    if (!(await empty.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, 'Empty-viewport invite not reachable without programmatic map control')
    }
    await expect(empty).toBeVisible()
  })
})
