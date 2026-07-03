/**
 * Overlay confinement — map-owned portaled surfaces must stay on the map tab.
 *
 * Spec: .kiro/specs/go-live-readiness (Requirement 5)
 *
 * The consumer shell keeps the Map mounted across tab switches and only hides
 * it with `display:none` (so Mapbox is never torn down). The Peek_Carousel and
 * the map's auth/QR/search sheets render through a `document.body` portal, so
 * without an `active`-tab gate they escape the hidden map and render on top of
 * Feed/Ranks/Profile. That exact leak (Peek_Carousel + flick arrows + "View
 * details" over the Feed tab, screenshot 2026-07-03 08:45) was fixed in
 * `c047c94`. These tests pin the fix.
 *
 * The Browse strip is intentionally non-modal (`BottomSheet modal={false}`): no
 * backdrop, and the map above the strip stays interactive so a user pan/zoom
 * can enter `area` scope (see .kiro/steering/map-carousel.md). Only Commit_Mode
 * is a modal takeover (backdrop + aria-modal). The last test pins that split.
 *
 * Data-driven, like map-discovery.spec.ts: the carousel only opens when a venue
 * is in view, so the suite skips with a clear reason where no nodes are seeded.
 */

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'
import { assertStructuralIntegrity } from '../../support/structure.js'

const NON_MAP_TABS: ReadonlyArray<{ label: string; tab: RegExp }> = [
  { label: 'Feed', tab: /^feed$/i },
  { label: 'Ranks', tab: /^ranks$/i },
  { label: 'Profile', tab: /^profile$/i },
]

test.describe('Consumer — overlay confinement (portaled surfaces stay on Map)', () => {
  test('the Peek-Carousel is confined to the Map tab (R5.1)', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })

    const carousel = consumer.peekCarousel(page)
    if (!(await carousel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Peek-Carousel not visible — environment likely has no nodes seeded in view')
    }

    // Leaving the Map tab must remove the carousel from view on every other tab.
    for (const { label, tab } of NON_MAP_TABS) {
      await consumer.navTab(page, tab).click()
      await expect(consumer.peekCarousel(page), `carousel must not leak onto ${label}`).not.toBeVisible()
    }

    // Returning to Map restores it (selection state persists in selectionStore).
    await consumer.navTab(page, /^map$/i).click()
    await expect(consumer.peekCarousel(page)).toBeVisible({ timeout: 10_000 })
  })

  test('no map-owned sheet (search, sign-in, QR) leaks onto other tabs (R5.2)', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })

    const carousel = consumer.peekCarousel(page)
    if (!(await carousel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Peek-Carousel not visible — no nodes seeded in view')
    }

    // Open the search sheet on the Map tab so there is a live portaled surface
    // to confine. (Sign-in/QR are gated behind a check-in flow; asserting their
    // absence still catches a portal that renders regardless of the active tab.)
    const searchControl = page.getByRole('button', { name: /search venues/i }).first()
    if (await searchControl.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchControl.click()
      await expect(consumer.searchSheet(page)).toBeVisible({ timeout: 10_000 })
    }

    for (const { label, tab } of NON_MAP_TABS) {
      await consumer.navTab(page, tab).click()
      await expect(consumer.searchSheet(page), `search sheet must not leak onto ${label}`).not.toBeVisible()
      await expect(consumer.signInSheet(page), `sign-in sheet must not leak onto ${label}`).not.toBeVisible()
      await expect(consumer.qrScannerSheet(page), `QR scanner must not leak onto ${label}`).not.toBeVisible()
    }
  })

  test('Browse is non-modal and Commit_Mode restores the modal contract (R5.3)', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })

    const carousel = consumer.peekCarousel(page)
    if (!(await carousel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Peek-Carousel not visible — no nodes seeded in view')
    }

    // Browse_Mode: non-modal. The portal wrapper lets pointer events fall
    // through to the map, and there is no backdrop sibling.
    await expect(carousel).toHaveAttribute('data-mode', 'browse')
    await expect(consumer.sheetPortal(page)).toHaveCSS('pointer-events', 'none')
    await expect(consumer.sheetBackdrop(page)).toHaveCount(0)
    await expect(consumer.sheetPanel(page)).not.toHaveAttribute('aria-modal', 'true')

    // Commit_Mode: modal takeover. Backdrop returns and the panel is aria-modal.
    await consumer.viewDetails(page).click()
    await expect(carousel).toHaveAttribute('data-mode', 'commit')
    await expect(consumer.sheetPanel(page)).toHaveAttribute('aria-modal', 'true')
    await expect(consumer.sheetBackdrop(page)).toHaveCount(1)
  })
})

test.describe('Consumer — structural integrity (authenticated shell)', () => {
  test('shell has no horizontal scroll, a reachable CTA and clean axe criticals', async ({ page, loginAs }) => {
    try {
      await loginAs('consumerA', 'consumer')
    } catch (e) {
      test.skip(true, `consumer fixture not available: ${String(e)}`)
    }
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })

    // The carousel-over-Feed leak (c) is pinned in full by the tests above, so
    // this sweep does not re-assert it (DRY). It navigates Map -> Profile only
    // to re-check no horizontal scroll on a second authenticated route.
    await assertStructuralIntegrity(page, {
      portal: 'consumer',
      primaryControl: (p) => consumer.navTab(p, /^map$/i),
      routeChange: {
        toSecond: async (p) => {
          await consumer.navTab(p, /^profile$/i).click()
        },
        secondLabel: 'Profile',
      },
    })
  })
})
