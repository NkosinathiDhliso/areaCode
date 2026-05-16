/**
 * Shared Playwright fixtures. Every spec imports `test` and `expect`
 * from here so the suite gets:
 *   - typed loginAs(account, portal)
 *   - typed apiAs(account)
 *   - automatic console-error collection (assert at end of test)
 */

import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'

import { apiAs, apiAnonymous } from './api.js'
import { TEST_ACCOUNTS, TEST_PASSWORD, URLS, type AccountKey } from './env.js'
import { auth as authSel } from './selectors.js'

type LoginPortal = 'consumer' | 'business' | 'staff' | 'admin'

const PORTAL_URL: Record<LoginPortal, () => string> = {
  consumer: URLS.consumer,
  business: URLS.business,
  staff: URLS.staff,
  admin: URLS.admin,
}

async function loginEmailPassword(page: Page, portal: LoginPortal, email: string, password: string): Promise<void> {
  await page.goto(PORTAL_URL[portal]())
  await authSel.emailField(page).waitFor({ state: 'visible' })
  await authSel.emailField(page).fill(email)
  await authSel.passwordField(page).fill(password)
  await authSel.submitButton(page).click()
  await expect(page).not.toHaveURL(/login|signin/i, { timeout: 20_000 })
}

type Fixtures = {
  loginAs: (account: AccountKey, portal: LoginPortal) => Promise<void>
  apiClient: (account: AccountKey) => Promise<APIRequestContext>
  anonApiClient: () => Promise<APIRequestContext>
  consoleErrors: string[]
}

export const test = base.extend<Fixtures>({
  loginAs: async ({ page }, use) => {
    await use(async (account, portal) => {
      const { email } = TEST_ACCOUNTS[account]
      await loginEmailPassword(page, portal, email, TEST_PASSWORD())
    })
  },

  apiClient: async ({}, use) => {
    const created: APIRequestContext[] = []
    await use(async (account) => {
      const ctx = await apiAs(account)
      created.push(ctx)
      return ctx
    })
    await Promise.all(created.map((c) => c.dispose()))
  },

  anonApiClient: async ({}, use) => {
    const created: APIRequestContext[] = []
    await use(async () => {
      const ctx = await apiAnonymous()
      created.push(ctx)
      return ctx
    })
    await Promise.all(created.map((c) => c.dispose()))
  },

  // Auto-collect console errors. Tests can read this and assert.
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
    })
    await use(errors)
  },
})

export { expect } from '@playwright/test'
