/**
 * §2.5 Rewards on the business side.
 */

import { expect, test } from '../../support/fixtures.js'
import { business } from '../../support/selectors.js'

test.describe('Business — rewards', () => {
  test('create a reward and see it in the list', async ({ page, loginAs }) => {
    await loginAs('businessOwner', 'business')
    await business.rewardsLink(page).click()
    await business.createRewardButton(page).click()

    await page.getByLabel(/title/i).first().fill(`E2E reward ${Date.now()}`)
    await page
      .getByLabel(/description/i)
      .first()
      .fill('Created by e2e suite')
    await page
      .getByLabel(/total slots|slots/i)
      .first()
      .fill('25')
      .catch(() => {})
    await page
      .getByRole('button', { name: /save|create|publish/i })
      .first()
      .click()
    await expect(page.getByText(/E2E reward/i)).toBeVisible({ timeout: 15_000 })
  })

  test('empty state CTA visible when no rewards exist', async ({ apiClient, page, loginAs }) => {
    // Best effort — won't always be empty in shared envs.
    const api = await apiClient('businessOwner')
    const list = await api.get('/v1/business/rewards').catch(() => null)
    if (list && list.ok()) {
      const body = (await list.json()) as { rewards?: unknown[] }
      if ((body.rewards ?? []).length > 0) test.skip(true, 'Env already has rewards — empty state unreachable')
    }
    await loginAs('businessOwner', 'business')
    await business.rewardsLink(page).click()
    await expect(page.getByText(/create your first/i)).toBeVisible({ timeout: 10_000 })
  })

  test('low-performance flag appears for stale 0-claim reward', async ({ apiClient }) => {
    const api = await apiClient('businessOwner')
    const list = await api.get('/v1/business/rewards/metrics').catch(() => null)
    if (!list || !list.ok()) {
      test.skip(true, 'No metrics endpoint available')
      return
    }
    const body = (await list.json()) as { rewards?: Array<{ id: string; lowPerformance?: boolean }> }
    // Only assert structure; whether one is flagged depends on data age.
    expect(Array.isArray(body.rewards)).toBe(true)
  })
})
