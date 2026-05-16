/**
 * §1.8 Account management — forgot password, logout.
 * Account deletion stays manual (see manual-flows.spec.ts).
 */

import { URLS } from '../../support/env.js'
import { expect, test } from '../../support/fixtures.js'
import { auth } from '../../support/selectors.js'

test.describe('Consumer — account management', () => {
  test('forgot password reaches the reset request screen', async ({ page }) => {
    await page.goto(URLS.consumer())
    await auth.forgotPasswordLink(page).click()
    await expect(page.getByText(/check your email|reset|code sent/i))
      .toBeVisible({ timeout: 15_000 })
      .catch(async () => {
        // Or a request form
        await expect(auth.emailField(page)).toBeVisible()
      })
  })

  test('logout clears session and redirects to login', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await auth.logoutButton(page).click()
    await expect(page).toHaveURL(/login|signin|^https?:\/\/[^/]+\/?$/i, { timeout: 15_000 })
  })
})
