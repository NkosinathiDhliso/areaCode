/**
 * Cross-portal lifecycle alignment (R5.6): the consumer profile surfaces a
 * parked (failed) check-in with retry and discard actions. A retry inside the
 * 15-minute Replay_Window re-queues the entry; the mocked check-in endpoint keeps
 * failing so the re-queued attempt stays pending (it leaves the parked list).
 *
 * The outbox is seeded directly into localStorage via an init script so the test
 * does not need to reproduce a real network failure to create the parked entry.
 */

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'

const OUTBOX_KEY = 'areacode.checkinOutbox.v1'

test.describe('Consumer — check-in outbox parked failures (R5.6)', () => {
  test('profile shows a parked check-in and Retry re-queues it', async ({ page, loginAs }) => {
    const now = Date.now()
    const parked = [
      {
        id: 'e2e-parked-1',
        nodeId: '11111111-1111-4111-8111-111111111111',
        type: 'reward',
        capturedAt: new Date(now).toISOString(),
        lat: -33.9249,
        lng: 18.4241,
        retryCount: 3,
        nextAttemptAt: new Date(now).toISOString(),
        parkedAt: new Date(now).toISOString(),
      },
    ]

    // Seed the outbox before any app script runs (init scripts fire on every
    // navigation, including the login goto).
    await page.addInitScript(
      (arg: { key: string; value: string }) => {
        window.localStorage.setItem(arg.key, arg.value)
      },
      { key: OUTBOX_KEY, value: JSON.stringify(parked) },
    )

    // Any replay attempt keeps failing (5xx = transient), so a re-queued entry
    // stays pending rather than clearing via success mid-test.
    await page.route('**/v1/check-in', (r) =>
      r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }),
    )

    try {
      await loginAs('consumerA', 'consumer')
    } catch (e) {
      test.skip(true, `consumer fixture not available: ${String(e)}`)
    }

    await consumer
      .profileLink(page)
      .click()
      .catch(() => {
        /* may already be on profile */
      })

    const section = page.getByTestId('parked-checkins')
    await expect(section).toBeVisible({ timeout: 15_000 })
    await expect(section.getByText(/Check-in not sent/i)).toBeVisible()

    // Retry re-queues the entry (it is no longer parked) — the row leaves the list.
    await section.getByRole('button', { name: /retry/i }).first().click()
    await expect(section.getByText(/Check-in not sent/i)).toHaveCount(0)
  })

  test('Discard removes the parked check-in', async ({ page, loginAs }) => {
    const now = Date.now()
    const parked = [
      {
        id: 'e2e-parked-2',
        nodeId: '11111111-1111-4111-8111-111111111111',
        type: 'reward',
        capturedAt: new Date(now).toISOString(),
        lat: -33.9249,
        lng: 18.4241,
        retryCount: 3,
        nextAttemptAt: new Date(now).toISOString(),
        parkedAt: new Date(now).toISOString(),
      },
    ]
    await page.addInitScript(
      (arg: { key: string; value: string }) => {
        window.localStorage.setItem(arg.key, arg.value)
      },
      { key: OUTBOX_KEY, value: JSON.stringify(parked) },
    )

    try {
      await loginAs('consumerA', 'consumer')
    } catch (e) {
      test.skip(true, `consumer fixture not available: ${String(e)}`)
    }

    await consumer
      .profileLink(page)
      .click()
      .catch(() => {})

    const section = page.getByTestId('parked-checkins')
    await expect(section).toBeVisible({ timeout: 15_000 })
    await section
      .getByRole('button', { name: /discard/i })
      .first()
      .click()
    await expect(page.getByTestId('parked-checkins')).toHaveCount(0)
  })
})
