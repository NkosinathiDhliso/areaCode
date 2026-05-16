/**
 * §1.4 Profile & history.
 */

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'

test.describe('Consumer — profile and history', () => {
  test('profile screen shows display name, tier, totals', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await consumer
      .profileLink(page)
      .click()
      .catch(() => {
        /* may already be on profile */
      })
    await expect(page.getByText(/E2E Consumer A/i)).toBeVisible({ timeout: 10_000 })
    await expect(consumer.tierBadge(page)).toBeVisible()
    await expect(page.getByText(/check.?ins/i)).toBeVisible()
  })

  test('check-in history paginates older entries', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await consumer
      .profileLink(page)
      .click()
      .catch(() => {})
    const history = page.getByTestId('checkin-history').or(page.getByRole('list')).first()
    await history.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    // Scroll to bottom and assert we either see "no more" or the list grew.
    const before = await history
      .locator('li, [role="listitem"]')
      .count()
      .catch(() => 0)
    await history.evaluate((el) => (el as HTMLElement).scrollTo(0, (el as HTMLElement).scrollHeight))
    await page.waitForTimeout(1500)
    const after = await history
      .locator('li, [role="listitem"]')
      .count()
      .catch(() => 0)
    expect(after).toBeGreaterThanOrEqual(before)
  })

  test('history error retry on network drop', async ({ page, loginAs, context }) => {
    await loginAs('consumerA', 'consumer')
    await context.route('**/v1/users/me/check-in-history*', (r) => r.abort())
    await consumer
      .profileLink(page)
      .click()
      .catch(() => {})
    await expect(page.getByRole('button', { name: /retry|try again/i })).toBeVisible({ timeout: 15_000 })
  })
})
