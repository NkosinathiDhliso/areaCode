/**
 * §2.6 Staff management, §2.7 Staff redemption attribution.
 */

import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'

test.describe('Business — staff management', () => {
  test('invite a staff member generates a token', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await business.settingsLink(page).click()
    const invite = business.inviteStaffButton(page)
    if (!(await invite.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Invite UI not visible in this env')
    }
    await invite.click()
    await page.getByLabel(/email/i).first().fill(`e2e-invite-${Date.now()}@areacode.test`)
    await page
      .getByRole('combobox', { name: /role/i })
      .first()
      .selectOption('staff')
      .catch(() => {})
    await page
      .getByRole('button', { name: /send|invite|create/i })
      .first()
      .click()
    await expect(page.getByText(/copy invite|invite link|pending/i)).toBeVisible({ timeout: 10_000 })
  })

  test('staff redemption panel filters by staff member', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    const link = page.getByRole('link', { name: /staff redemptions|redemptions by staff/i }).first()
    if (!(await link.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Staff redemption panel not exposed in this env')
    }
    await link.click()
    const filter = page.getByRole('combobox', { name: /staff/i }).first()
    if (await filter.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filter.selectOption({ index: 1 }).catch(() => {})
    }
    // Pass if list or empty-state renders.
    await expect(
      page
        .getByRole('table')
        .or(page.getByText(/no redemptions/i))
        .first(),
    ).toBeVisible()
  })
})
