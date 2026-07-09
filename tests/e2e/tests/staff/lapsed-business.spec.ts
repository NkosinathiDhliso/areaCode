/**
 * Cross-portal lifecycle alignment (R3.1): the staff home renders the
 * Lapsed_Business_Banner when the bootstrap read reports the business as lapsed,
 * without blocking the validator (earned codes still redeem, R3.2).
 *
 * The `/v1/staff/business` bootstrap read is stubbed to the lapsed shape so the
 * test does not depend on a demoted fixture business existing in the dev data.
 */

import { expect, test } from '../../support/fixtures.js'
import { staff } from '../../support/selectors.js'

test.describe('Staff — lapsed business banner (R3)', () => {
  test('renders the lapsed banner and keeps the validator available', async ({ page, loginAs }) => {
    // Stub the bootstrap read BEFORE login so the StaffHome mount fetch is caught.
    await page.route('**/v1/staff/business', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ businessName: 'Lapsed Venue', isActive: false, businessState: 'lapsed' }),
      }),
    )

    try {
      await loginAs('staffMember', 'staff')
    } catch (e) {
      test.skip(true, `staff fixture not available: ${String(e)}`)
    }

    // The banner names the state (no billing amounts).
    await expect(page.getByText(/no longer active/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/left Area Code/i)).toBeVisible()

    // The validator is still present — a lapsed venue can still scan earned codes.
    await expect(staff.scanQrButton(page)).toBeVisible()
  })

  test('does not render the banner when the business is active', async ({ page, loginAs }) => {
    await page.route('**/v1/staff/business', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ businessName: 'Active Venue', isActive: true, businessState: 'active' }),
      }),
    )

    try {
      await loginAs('staffMember', 'staff')
    } catch (e) {
      test.skip(true, `staff fixture not available: ${String(e)}`)
    }

    await expect(staff.scanQrButton(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/no longer active/i)).toHaveCount(0)
  })
})
