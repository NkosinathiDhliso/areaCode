/**
 * §8 Mobile responsiveness — sweep all four portals at three viewports.
 *
 * Pass criteria: page loads, no horizontal scroll, primary CTA reachable
 * within the viewport. Visual fidelity is checked manually.
 */

import { expect, test } from '@playwright/test'

import { URLS } from '../support/env.js'

const VIEWPORTS = [
  { width: 375, height: 667, label: 'iPhone SE' },
  { width: 414, height: 896, label: 'iPhone 11' },
  { width: 768, height: 1024, label: 'iPad portrait' },
] as const

const PORTALS: Array<[string, () => string]> = [
  ['consumer', URLS.consumer],
  ['business', URLS.business],
  ['staff', URLS.staff],
  ['admin', URLS.admin],
]

for (const [name, url] of PORTALS) {
  for (const vp of VIEWPORTS) {
    test(`${name} @ ${vp.label} (${vp.width}x${vp.height}) — no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(url())
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(overflow).toBe(false)

      // Primary CTA — login button — should be visible.
      const cta = page.getByRole('button', { name: /(sign in|log in|continue)/i }).first()
      await expect(cta).toBeVisible({ timeout: 10_000 })
    })
  }
}
