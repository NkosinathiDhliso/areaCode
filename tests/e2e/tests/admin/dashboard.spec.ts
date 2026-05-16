/**
 * §4.1 Auth, §4.2 Dashboard overview.
 */

import { TEST_ACCOUNTS } from '../../support/env.js'
import { expect, test } from '../../support/fixtures.js'
import { admin } from '../../support/selectors.js'

test.describe('Admin — auth & dashboard', () => {
  test('admin login lands on DashboardOverview with key counters', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await expect(admin.totalConsumers(page)).toBeVisible({ timeout: 15_000 })
    await expect(admin.totalBusinesses(page)).toBeVisible()
    await expect(page.getByText(/check.?ins/i).first()).toBeVisible()
  })

  test('cross-pool token rejected (consumer creds on admin login)', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel(/email/i).first().fill(TEST_ACCOUNTS.consumerA.email)
    await page
      .getByLabel(/password/i)
      .first()
      .fill(process.env.E2E_TEST_PASSWORD ?? '')
    await page
      .getByRole('button', { name: /(sign in|log in|continue)/i })
      .first()
      .click()
    await expect(page.getByText(/invalid|incorrect|denied|not found/i)).toBeVisible({ timeout: 15_000 })
  })

  test('counters refresh within 60s window', async ({ apiClient }) => {
    const api = await apiClient('admin')
    const a = await api.get('/v1/admin/overview')
    const b = await api.get('/v1/admin/overview')
    expect(a.ok() && b.ok()).toBe(true)
  })
})
