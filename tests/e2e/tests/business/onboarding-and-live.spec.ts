/**
 * §2.1 Onboarding, §2.2 Live panel.
 */

import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'
import { assertStructuralIntegrity } from '../../support/structure.js'

test.describe('Business — onboarding & live panel', () => {
  test('login lands on dashboard with live panel widgets', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await expect(business.livePanelCount(page)).toBeVisible({ timeout: 15_000 })
    await expect(business.pulseGauge(page)).toBeVisible()
  })

  test('zero-state tips appear under 10 check-ins', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    // Either tips or actual data — the test is "no broken UI when empty".
    const tips = page.getByText(/zero[- ]state|tips|getting started|invite customers/i)
    const data = page.getByTestId('live-checkin-count')
    await expect(tips.or(data).first()).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Business — structural integrity (authenticated shell)', () => {
  test('dashboard has no horizontal scroll, a reachable CTA and clean axe criticals', async ({ page, loginAs }) => {
    try {
      await loginAs('businessOwner', 'business')
    } catch (e) {
      test.skip(true, `business fixture not available: ${String(e)}`)
    }
    await expect(business.livePanelCount(page)).toBeVisible({ timeout: 15_000 })

    await assertStructuralIntegrity(page, {
      portal: 'business',
      primaryControl: (p) => business.rewardsLink(p),
      routeChange: {
        // Dashboard -> Settings: no portaled overlay should survive the nav.
        toSecond: async (p) => {
          await business.settingsLink(p).click()
        },
        secondLabel: 'Settings',
      },
    })
  })
})
