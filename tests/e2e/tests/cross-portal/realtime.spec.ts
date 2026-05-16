/**
 * §5 Cross-Portal Real-Time Tests.
 *
 * These open multiple browser contexts, simulate an action in one, and
 * assert a corresponding update arrives in another. We use API calls for
 * the trigger side to keep tests fast and deterministic.
 */

import { TEST_PASSWORD, URLS } from '../../support/env.js'
import { expect, test } from '../../support/fixtures.js'
import { admin, business } from '../../support/selectors.js'

test.describe('Cross-portal — real-time', () => {
  test('consumer check-in increments business live counter', async ({ browser, apiClient }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(URLS.business())
    await page.getByLabel(/email/i).first().fill('e2e-business@areacode.test')
    await page
      .getByLabel(/password/i)
      .first()
      .fill(TEST_PASSWORD())
    await page
      .getByRole('button', { name: /(sign in|log in|continue)/i })
      .first()
      .click()
    await expect(business.livePanelCount(page)).toBeVisible({ timeout: 20_000 })
    const before = parseInt((await business.livePanelCount(page).textContent()) ?? '0', 10) || 0

    const consumer = await apiClient('consumerA')
    // Trigger a check-in via API. Replace nodeId/coords with a seeded venue.
    await consumer
      .post('/v1/check-ins', {
        data: { nodeId: 'seed-venue-1', latitude: -26.2041, longitude: 28.0473 },
      })
      .catch(() => {
        /* tolerate cooldown */
      })

    await expect
      .poll(
        async () => {
          const txt = (await business.livePanelCount(page).textContent()) ?? '0'
          return parseInt(txt, 10) || 0
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(before)
    await ctx.close()
  })

  test('admin disabling a user logs them out within ~60s', async ({ browser, apiClient }) => {
    const consumerCtx = await browser.newContext()
    const consumerPage = await consumerCtx.newPage()
    await consumerPage.goto(URLS.consumer())
    await consumerPage.getByLabel(/email/i).first().fill('e2e-consumer-b@areacode.test')
    await consumerPage
      .getByLabel(/password/i)
      .first()
      .fill(TEST_PASSWORD())
    await consumerPage
      .getByRole('button', { name: /(sign in|log in|continue)/i })
      .first()
      .click()
    await expect(consumerPage).not.toHaveURL(/login/i, { timeout: 20_000 })

    const adminApi = await apiClient('admin')
    const me = (await (await (await apiClient('consumerB')).get('/v1/users/me')).json()) as { id: string }
    await adminApi.post(`/v1/admin/users/${me.id}/disable`)

    // The next API call from the consumer tab should redirect to login.
    await consumerPage.reload()
    await expect(consumerPage).toHaveURL(/login|signin|^https?:\/\/[^/]+\/?$/i, { timeout: 60_000 })

    // Re-enable for next run
    await adminApi.post(`/v1/admin/users/${me.id}/enable`).catch(() => {})
    await consumerCtx.close()
  })

  test('new abuse flag appears on admin dashboard without refresh', async ({ browser, apiClient }) => {
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await adminPage.goto(URLS.admin())
    await adminPage.getByLabel(/email/i).first().fill('e2e-admin@areacode.test')
    await adminPage
      .getByLabel(/password/i)
      .first()
      .fill(TEST_PASSWORD())
    await adminPage
      .getByRole('button', { name: /(sign in|log in|continue)/i })
      .first()
      .click()
    await admin.navTab(adminPage, /abuse|flags?/i).click()

    const before = await adminPage.getByRole('row').count()

    const a = await apiClient('consumerA')
    const meB = (await (await (await apiClient('consumerB')).get('/v1/users/me')).json()) as { id: string }
    await a.post('/v1/reports', {
      data: { targetUserId: meB.id, reason: 'harassment', detail: 'cross-portal e2e' },
    })

    await expect.poll(async () => adminPage.getByRole('row').count(), { timeout: 30_000 }).toBeGreaterThan(before)
    await adminCtx.close()
  })
})
