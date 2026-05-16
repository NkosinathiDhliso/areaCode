/**
 * §1.1 Sign up & first launch (automatable parts)
 * §1.2 Map & discovery
 * §1.3 Check-in
 *
 * Real Google OAuth and SMS OTP delivery remain manual checks.
 */

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'

test.describe('Consumer — login, map, check-in', () => {
  test('email login lands on the map', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await expect(consumer.map(page)).toBeVisible({ timeout: 20_000 })
  })

  test('skip onboarding goes straight to map', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    const skip = page.getByRole('button', { name: /^skip$/i }).first()
    if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) await skip.click()
    await expect(consumer.map(page)).toBeVisible()
  })

  test('search filters venue list and shows no-results state', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    const search = consumer.searchBox(page)
    await search.waitFor({ state: 'visible' })
    await search.fill('zzz_no_match_expected_xyz')
    await expect(consumer.noResults(page)).toBeVisible({ timeout: 5_000 })
    await search.fill('')
  })

  test('out-of-range check-in returns accuracy_insufficient', async ({ page, loginAs, context }) => {
    await context.setGeolocation({ latitude: 0, longitude: 0 })
    await loginAs('consumerA', 'consumer')
    const btn = consumer.checkInButton(page)
    if (!(await btn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'No check-in button visible — environment may have no nodes seeded')
    }
    await btn.click()
    await expect(page.getByText(/accuracy|too far|out of range/i)).toBeVisible({ timeout: 10_000 })
  })

  test('check-in cooldown surfaces clear error on rapid retry', async ({ page, loginAs, context }) => {
    // Place us inside a known venue radius. The exact lat/lng must be one
    // of your seeded venues — replace with a permanent staging fixture.
    await context.setGeolocation({ latitude: -26.2041, longitude: 28.0473 })
    await loginAs('consumerA', 'consumer')
    const btn = consumer.checkInButton(page)
    if (!(await btn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'No check-in button — seed a venue at JHB centre to enable this test')
    }
    await btn.click()
    // Press it again immediately
    await btn.click()
    await expect(consumer.cooldownToast(page)).toBeVisible({ timeout: 10_000 })
  })
})
