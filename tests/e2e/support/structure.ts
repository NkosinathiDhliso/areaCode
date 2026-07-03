/**
 * Shared structural-integrity helper for the authenticated shell of every
 * portal. One home for the four checks the go-live e2e layer owns (see
 * .kiro/specs/go-live-readiness Requirement 5, tasks 8 and 10):
 *
 *   (a) no horizontal scroll (documentElement.scrollWidth <= clientWidth,
 *       within a small tolerance),
 *   (b) the primary interactive control is reachable / visible,
 *   (c) no portaled overlay leaks across a route/tab change (navigate between
 *       two primary routes and assert the first route's overlay is gone),
 *   (d) axe criticals are clean (same @axe-core/playwright setup as
 *       accessibility.spec.ts, filtered to impact === 'critical').
 *
 * Portal specs import `assertStructuralIntegrity` and pass a small config
 * describing their shell (primary control + optional route change). The four
 * portal projects each supply the right baseURL/device/permissions, so this
 * helper stays portal-agnostic. Reuse `selectors.ts` for the locators.
 *
 * This is the single home for the "authenticated shell is structurally sound"
 * assertion. accessibility.spec.ts checks unauthenticated login screens and
 * mobile-sweep.spec.ts checks pre-login viewports; neither logs in, so this
 * helper is additive, not a fork of either.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

/** documentElement overflow tolerance in px; sub-pixel rounding is not a bug. */
const DEFAULT_SCROLL_TOLERANCE = 2

/** Rules disabled to match accessibility.spec.ts (region fires on SPA paint). */
const DEFAULT_AXE_DISABLE_RULES = ['region'] as const

/** WCAG tag set, identical to accessibility.spec.ts. */
const AXE_TAGS = ['wcag2a', 'wcag2aa'] as const

export interface StructuralRouteChange {
  /**
   * Optional: open an overlay on the first route so (c) has a live portaled
   * surface to confine. Return true if it opened; false/throw is treated as
   * "nothing to open" and the leak assertion still runs against `overlay`.
   */
  openOverlay?: (page: Page) => Promise<boolean>
  /** The overlay owned by the first route that must NOT survive the switch. */
  overlay?: (page: Page) => Locator
  /** Navigate to the second primary route/tab. */
  toSecond: (page: Page) => Promise<void>
  /** Human label for the second route, used in assertion messages. */
  secondLabel: string
}

export interface StructuralIntegrityOptions {
  /** Portal name, used only in assertion messages. */
  portal: string
  /** The primary interactive control that must be reachable on the shell. */
  primaryControl: (page: Page) => Locator
  /** Optional route/tab change for the overlay-leak check (c). */
  routeChange?: StructuralRouteChange
  /** Extra axe rule ids to disable on top of the shared defaults. */
  axeDisableRules?: readonly string[]
  /** Horizontal-scroll tolerance in px (default 2). */
  scrollTolerance?: number
  /** Visibility timeout for the primary control (default 15s). */
  primaryControlTimeout?: number
}

/** (a) Assert the document does not scroll horizontally beyond `tolerance` px. */
export async function expectNoHorizontalScroll(
  page: Page,
  portal: string,
  tolerance: number = DEFAULT_SCROLL_TOLERANCE,
): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return el.scrollWidth - el.clientWidth
  })
  expect(overflow, `${portal}: horizontal overflow of ${overflow}px (tolerance ${tolerance}px)`).toBeLessThanOrEqual(
    tolerance,
  )
}

/** (d) Assert axe reports no critical violations for the current page state. */
export async function expectAxeCriticalsClean(
  page: Page,
  portal: string,
  extraDisableRules: readonly string[] = [],
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...AXE_TAGS])
    .disableRules([...DEFAULT_AXE_DISABLE_RULES, ...extraDisableRules])
    .analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical, `${portal} axe criticals:\n${JSON.stringify(critical, null, 2)}`).toEqual([])
}

/**
 * (c) Navigate first -> second route and assert the first route's overlay does
 * not leak onto the second. Re-checks (a) on the second route too.
 */
async function assertNoOverlayLeak(
  page: Page,
  portal: string,
  routeChange: StructuralRouteChange,
  tolerance: number,
): Promise<void> {
  let overlayOpened = false
  if (routeChange.openOverlay) {
    overlayOpened = await routeChange.openOverlay(page).catch(() => false)
  }
  if (routeChange.overlay && overlayOpened) {
    await expect(routeChange.overlay(page)).toBeVisible({ timeout: 10_000 })
  }

  await routeChange.toSecond(page)

  if (routeChange.overlay) {
    await expect(
      routeChange.overlay(page),
      `${portal}: overlay must not leak onto ${routeChange.secondLabel}`,
    ).not.toBeVisible()
  }
  // A route that introduces horizontal overflow is as much a structural leak.
  await expectNoHorizontalScroll(page, `${portal} (${routeChange.secondLabel})`, tolerance)
}

/**
 * Run the full structural-integrity sweep on an already-authenticated page:
 * primary control reachable, no horizontal scroll, axe criticals clean, and
 * (when a route change is configured) no portaled overlay leak across routes.
 */
export async function assertStructuralIntegrity(page: Page, options: StructuralIntegrityOptions): Promise<void> {
  const tolerance = options.scrollTolerance ?? DEFAULT_SCROLL_TOLERANCE

  // (b) Primary interactive control is reachable on the authenticated shell.
  await expect(options.primaryControl(page), `${options.portal}: primary control not reachable`).toBeVisible({
    timeout: options.primaryControlTimeout ?? 15_000,
  })

  // (a) No horizontal scroll on the landing shell.
  await expectNoHorizontalScroll(page, options.portal, tolerance)

  // (d) axe criticals clean on the landing shell.
  await expectAxeCriticalsClean(page, options.portal, options.axeDisableRules)

  // (c) No portaled overlay leaks across a route/tab change (when applicable).
  if (options.routeChange) {
    await assertNoOverlayLeak(page, options.portal, options.routeChange, tolerance)
  }
}
