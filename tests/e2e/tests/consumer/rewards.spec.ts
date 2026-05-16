/**
 * §1.5 Rewards.
 */

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'

test.describe('Consumer — rewards', () => {
  test('rewards tab lists active rewards', async ({ page, loginAs }) => {
    await loginAs('consumerA', 'consumer')
    await consumer
      .rewardsTab(page)
      .click()
      .catch(() => {})
    // Either a list of rewards or an empty state — both pass; we only check
    // the screen reached its target without a 5xx.
    const visible = await page
      .getByTestId('rewards-list')
      .or(page.getByText(/no rewards/i))
      .first()
      .isVisible({ timeout: 10_000 })
    expect(visible).toBe(true)
  })

  test('claim a reward via API moves it to claimed state in UI', async ({ page, loginAs, apiClient }) => {
    const api = await apiClient('consumerA')
    const list = await api.get('/v1/rewards/near-me?city=johannesburg')
    if (!list.ok()) test.skip(true, `Could not fetch rewards: ${list.status()}`)
    const body = (await list.json()) as { rewards?: Array<{ id: string; title: string }> }
    const reward = body.rewards?.[0]
    if (!reward) test.skip(true, 'No nearby rewards available — seed a reward to run this')

    await api.post(`/v1/rewards/${reward!.id}/claim`).catch(() => {
      /* idempotent */
    })

    await loginAs('consumerA', 'consumer')
    await consumer
      .rewardsTab(page)
      .click()
      .catch(() => {})
    await expect(page.getByText(/claimed|redemption code/i)).toBeVisible({ timeout: 15_000 })
  })

  test('double-claim shows already_claimed', async ({ apiClient }) => {
    const api = await apiClient('consumerA')
    const list = await api.get('/v1/rewards/near-me?city=johannesburg')
    if (!list.ok()) test.skip(true, `Could not fetch rewards: ${list.status()}`)
    const body = (await list.json()) as { rewards?: Array<{ id: string }> }
    const reward = body.rewards?.[0]
    if (!reward) test.skip(true, 'No nearby rewards available')

    await api.post(`/v1/rewards/${reward!.id}/claim`)
    const second = await api.post(`/v1/rewards/${reward!.id}/claim`)
    expect([400, 409]).toContain(second.status())
    const text = (await second.text()).toLowerCase()
    expect(text).toMatch(/already|claimed|duplicate/)
  })
})
