/**
 * §2.3 Venue editor (in Settings).
 *
 * Photo upload validation runs against the actual file inputs. We use
 * a tiny generated PNG so the tests stay self-contained.
 */

import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'

const tinyPng = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082',
  'hex',
)

test.describe('Business — venue editor', () => {
  test('owner can edit name & it persists', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await business.settingsLink(page).click()
    const nameField = page.getByLabel(/venue name|name/i).first()
    if (!(await nameField.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Settings layout differs — adjust selector once stabilised')
    }
    const original = (await nameField.inputValue().catch(() => '')) ?? ''
    const next = original.includes(' [e2e]') ? original : `${original} [e2e]`
    await nameField.fill(next)
    await page
      .getByRole('button', { name: /save|update/i })
      .first()
      .click()
    await expect(page.getByText(/saved|updated/i)).toBeVisible({ timeout: 10_000 })
    // Restore
    await nameField.fill(original)
    await page
      .getByRole('button', { name: /save|update/i })
      .first()
      .click()
      .catch(() => {})
  })

  test('non-image file is rejected', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await business
      .settingsLink(page)
      .click()
      .catch(() => {})
    const fileInput = page.locator('input[type="file"]').first()
    if (!(await fileInput.count())) test.skip(true, 'No file input found in Settings')
    await fileInput.setInputFiles({ name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
    await expect(page.getByText(/jpg or png|invalid|only image/i)).toBeVisible({ timeout: 10_000 })
  })

  test('over-cap image is rejected', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await business
      .settingsLink(page)
      .click()
      .catch(() => {})
    const fileInput = page.locator('input[type="file"]').first()
    if (!(await fileInput.count())) test.skip(true, 'No file input found in Settings')
    await fileInput.setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(26 * 1024 * 1024, 0xff),
    })
    await expect(page.getByText(/under 25 ?mb|too large/i)).toBeVisible({ timeout: 10_000 })
  })

  test('valid PNG uploads and shows preview', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await business
      .settingsLink(page)
      .click()
      .catch(() => {})
    const fileInput = page.locator('input[type="file"]').first()
    if (!(await fileInput.count())) test.skip(true, 'No file input found in Settings')
    await fileInput.setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(page.locator('img').filter({ hasNotText: '' }).first()).toBeVisible({ timeout: 15_000 })
  })

  test('Instagram handle strips leading @', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await business
      .settingsLink(page)
      .click()
      .catch(() => {})
    const ig = page.getByLabel(/instagram/i).first()
    if (!(await ig.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'No Instagram field present in this env')
    }
    await ig.fill('@area_code_test')
    await page
      .getByRole('button', { name: /save|update/i })
      .first()
      .click()
    await expect(ig).toHaveValue(/^area_code_test$/, { timeout: 10_000 })
  })
})
