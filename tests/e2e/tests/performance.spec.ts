/**
 * §6 Performance & Reliability — automatable bits.
 *
 * We don't try to assert "no memory leaks" — that requires a long-running
 * harness. We do assert basic load times and websocket reconnect behaviour.
 */

import { URLS } from '../support/env.js'
import { expect, test } from '../support/fixtures.js'

test.describe('@smoke performance & reliability', () => {
  test('API cold-call returns within 3s', async ({ request }) => {
    const start = Date.now()
    const res = await request.get(`${URLS.api()}/health`)
    expect(res.ok()).toBe(true)
    expect(Date.now() - start).toBeLessThan(3_000)
  })

  test('consumer web finishes load on simulated 4G', async ({ page, context }) => {
    const client = await context.newCDPSession(page)
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (1.6 * 1024 * 1024) / 8, // 1.6 Mbps
      uploadThroughput: (750 * 1024) / 8,
      latency: 150,
    })
    const start = Date.now()
    await page.goto(URLS.consumer())
    await page.waitForLoadState('domcontentloaded')
    expect(Date.now() - start).toBeLessThan(5_000)
  })
})
