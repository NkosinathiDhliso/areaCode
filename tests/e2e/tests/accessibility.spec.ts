/**
 * §9 Accessibility spot checks.
 *
 * We use axe-core via @axe-core/playwright to catch the obvious gaps:
 * missing labels, low contrast, role mismatches. Full WCAG validation
 * requires manual screen-reader testing — see UAT_CHECKLIST.md.
 */

import AxeBuilder from '@axe-core/playwright'

import { URLS } from '../support/env.js'
import { expect, test } from '../support/fixtures.js'

const portals: Array<[name: string, url: () => string]> = [
  ['consumer', URLS.consumer],
  ['business', URLS.business],
  ['staff', URLS.staff],
  ['admin', URLS.admin],
]

for (const [name, url] of portals) {
  test(`accessibility — ${name} login screen has no critical violations`, async ({ page }) => {
    await page.goto(url())
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['region']) // Many SPAs trigger this on initial paint
      .analyze()
    const critical = results.violations.filter((v) => v.impact === 'critical')
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([])
  })
}

test.describe('@smoke accessibility — focus indicators', () => {
  test('tabbing through consumer login reaches submit', async ({ page }) => {
    await page.goto(URLS.consumer())
    // Press Tab a few times until the submit button is focused or we give up.
    let reached = false
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '')
      if (/sign in|log in|continue/i.test(focusedText)) {
        reached = true
        break
      }
    }
    expect(reached).toBe(true)
  })
})
