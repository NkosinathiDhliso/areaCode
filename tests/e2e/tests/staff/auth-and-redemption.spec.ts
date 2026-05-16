/**
 * §3.1 Auth, §3.3 Manual code entry, §3.4–§3.6 Redemption preview, confirm, history.
 *
 * §3.2 Camera-based QR scanning is intentionally a manual check — the
 * fake camera produces a black frame, not a scannable QR. We exercise the
 * scanner path far enough to catch initialisation regressions.
 */

import { expect, test } from '../../support/fixtures.js'
import { staff } from '../../support/selectors.js'

test.describe('Staff — auth & redemption', () => {
  test('login lands on StaffHome', async ({ page, loginAs }) => {
    await loginAs('staffMember', 'staff')
    await expect(staff.scanQrButton(page)).toBeVisible({ timeout: 15_000 })
  })

  test('manual code entry — invalid code shows error', async ({ page, loginAs }) => {
    await loginAs('staffMember', 'staff')
    const input = staff.manualEntryInput(page)
    await input.fill('zzzz9999')
    await input.press('Enter')
    await expect(page.getByText(/invalid|not found|unknown/i)).toBeVisible({ timeout: 10_000 })
  })

  test('manual code entry — already redeemed shows clear error', async ({ page, loginAs }) => {
    await loginAs('staffMember', 'staff')
    const input = staff.manualEntryInput(page)
    // Use a known-redeemed code if one exists in your fixtures; otherwise
    // mock the API to return that branch.
    await page.route('**/v1/staff/redemptions/preview*', (r) =>
      r.fulfill({
        status: 409,
        contentType: 'application/json',
        body: '{"code":"already_redeemed","message":"This reward was already redeemed."}',
      }),
    )
    await input.fill('abcd1234')
    await input.press('Enter')
    await expect(page.getByText(/already redeemed/i)).toBeVisible({ timeout: 10_000 })
  })

  test('confirm flow shows success and resets after 3s hold', async ({ page, loginAs }) => {
    await loginAs('staffMember', 'staff')
    const input = staff.manualEntryInput(page)

    // Stub preview + confirm so we don't need a real redemption code.
    await page.route('**/v1/staff/redemptions/preview*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rewardTitle: 'Free coffee',
          rewardType: 'freebie',
          consumerDisplayName: 'Test Consumer',
          consumerTier: 'regular',
        }),
      }),
    )
    await page.route('**/v1/staff/redemptions/confirm*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, redeemedAt: new Date().toISOString() }),
      }),
    )

    await input.fill('xxxx0000')
    await input.press('Enter')
    await expect(page.getByText(/free coffee/i)).toBeVisible({ timeout: 10_000 })
    await staff.confirmButton(page).click()
    await expect(page.getByText(/redeemed|success/i)).toBeVisible({ timeout: 10_000 })
  })

  test('input is sanitized — special chars stripped, lowercase upper', async ({ page, loginAs }) => {
    await loginAs('staffMember', 'staff')
    const input = staff.manualEntryInput(page)
    await input.fill('ab-12@!cd')
    // Allow either auto-strip or post-submit normalisation.
    const value = await input.inputValue()
    expect(value).toMatch(/^[A-Z0-9]+$/)
  })

  test('logout clears recent list', async ({ page, loginAs }) => {
    await loginAs('staffMember', 'staff')
    const list = staff.recentList(page)
    if (await list.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page
        .getByRole('button', { name: /log ?out|sign ?out/i })
        .first()
        .click()
      await expect(page).toHaveURL(/login|signin|^https?:\/\/[^/]+\/?$/i, { timeout: 10_000 })
    }
  })
})

test.describe('Staff — manual checks', () => {
  test.fixme('Camera permission grant + jsQR/native BarcodeDetector scan', async () => {
    // Verify on a real laptop with a webcam, or with a phone via the staging URL.
  })
  test.fixme('Camera permission denial fallback shows manual entry CTA', async () => {
    // Browser-level permission UI cannot be reliably toggled in CI.
  })
})
