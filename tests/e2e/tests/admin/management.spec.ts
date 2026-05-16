/**
 * §4.3 Consumer management, §4.4 Business management, §4.5 Node management.
 */

import { expect, test } from '../../support/fixtures.js'
import { admin } from '../../support/selectors.js'

test.describe('Admin — consumers, businesses, nodes', () => {
  test('consumer list searchable & detail page reachable', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin.navTab(page, /consumers?/i).click()
    await admin.searchInput(page).fill('e2e-consumer-a')
    await page.keyboard.press('Enter')
    const row = page.getByRole('row', { name: /e2e-consumer-a/i }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    await expect(page.getByText(/check.?in history|reports/i)).toBeVisible()
  })

  test('disable consumer requires confirmation', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin.navTab(page, /consumers?/i).click()
    await admin.searchInput(page).fill('e2e-consumer-b')
    await page.keyboard.press('Enter')
    const row = page.getByRole('row', { name: /e2e-consumer-b/i }).first()
    if (!(await row.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'No consumer found — seed one first')
    }
    await row.click()
    await admin.disableButton(page).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
    await page
      .getByRole('button', { name: /cancel/i })
      .first()
      .click()
  })

  test('businesses list is searchable', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin.navTab(page, /businesses?/i).click()
    await admin.searchInput(page).fill('e2e-business')
    await page.keyboard.press('Enter')
    await expect(page.getByText(/e2e-business/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('nodes list — empty state copy is concise', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin.navTab(page, /nodes?/i).click()
    // Either rows or a small empty state — count chars on the empty state.
    const empty = page.getByText(/no nodes|nothing here/i)
    if (await empty.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const text = (await empty.textContent()) ?? ''
      expect(text.length).toBeLessThan(120)
    } else {
      await expect(page.getByRole('table').or(page.getByRole('list')).first()).toBeVisible()
    }
  })
})
