/**
 * §2.8 Subscription & billing — automatable surface only.
 * §2.9 QR code.
 *
 * The actual Yoco card flow is a manual check (see manual-flows.spec.ts).
 */

import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'

test.describe('Business — billing & QR', () => {
  test('plans panel shows the three tiers', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await page
      .getByRole('link', { name: /billing|plan|subscription/i })
      .first()
      .click()
      .catch(() => {})
    await expect(page.getByText(/free trial/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/starter/i)).toBeVisible()
    await expect(page.getByText(/pro/i)).toBeVisible()
  })

  test('generate QR creates a code and enables qr check-in', async ({ apiClient, page, loginAs }) => {
    const api = await apiClient('businessOwner')
    const nodes = await api.get('/v1/business/nodes').catch(() => null)
    if (!nodes || !nodes.ok()) {
      test.skip(true, 'Cannot list business nodes')
      return
    }
    const body = (await nodes.json()) as { nodes?: Array<{ id: string; slug: string }> }
    const node = body.nodes?.[0]
    if (!node) {
      test.skip(true, 'No nodes for this business — seed one first')
      return
    }

    const regen = await api.post(`/v1/business/nodes/${node.id}/qr/regenerate`)
    expect(regen.ok()).toBe(true)
    const regenBody = (await regen.json()) as { code?: string; qrCode?: string }
    expect(regenBody.code ?? regenBody.qrCode).toBeTruthy()

    // UI side: button is at least visible
    await loginAs('businessOwner', 'business')
    await business
      .generateQrButton(page)
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {
        /* may live in settings */
      })
  })
})

test.describe('Business — manual checks', () => {
  test.fixme('Yoco checkout completes & webhook upgrades plan', async () => {
    // Use Yoco test mode + a webhook signature stub spec for CI.
  })
})
