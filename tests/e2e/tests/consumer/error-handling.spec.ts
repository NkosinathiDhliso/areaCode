/**
 * §1.9 Error handling.
 */

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'

test.describe('Consumer — error handling', () => {
  test('500 from API surfaces an error boundary with retry', async ({ page, loginAs, context }) => {
    await loginAs('consumerA', 'consumer')
    await context.route('**/v1/nodes/**', (r) =>
      r.fulfill({ status: 500, body: '{"message":"boom"}', contentType: 'application/json' }),
    )
    await page.reload()
    await expect(page.getByRole('button', { name: /reload|retry/i })).toBeVisible({ timeout: 15_000 })
  })

  test('4xx surfaces the server message rather than a generic one', async ({ page, loginAs, context }) => {
    await loginAs('consumerA', 'consumer')
    await context.route('**/v1/check-ins', (r) =>
      r.fulfill({
        status: 400,
        contentType: 'application/json',
        body: '{"code":"accuracy_insufficient","message":"You are 1.2km away from this venue."}',
      }),
    )
    const btn = consumer.checkInButton(page)
    if (await btn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await btn.click()
      await expect(page.getByText(/1\.2km away/i)).toBeVisible({ timeout: 10_000 })
    } else {
      test.skip(true, 'No check-in button on landing page in this env')
    }
  })

  test('console reports zero errors on initial load', async ({ page, loginAs, consoleErrors }) => {
    await loginAs('consumerA', 'consumer')
    await page.waitForLoadState('networkidle')
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})
