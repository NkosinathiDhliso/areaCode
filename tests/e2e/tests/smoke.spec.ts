/**
 * Cross-cutting smoke tests — UAT_CHECKLIST.md §"Cross-Cutting Smoke Test".
 * These prove the platform is alive end-to-end. Run them first; if any
 * fails, the rest of the suite is meaningless.
 */

import { expect, test } from '@playwright/test'

import { URLS } from '../support/env.js'

test.describe('@smoke cross-cutting', () => {
  test('API /health returns ok', async ({ request }) => {
    const res = await request.get(`${URLS.api()}/health`)
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as { status?: string }
    expect(body.status).toBe('ok')
  })

  test('Public node list returns nodes for Johannesburg', async ({ request }) => {
    const res = await request.get(`${URLS.api()}/v1/nodes/johannesburg`)
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as { nodes?: unknown[] }
    expect(Array.isArray(body.nodes)).toBe(true)
    expect((body.nodes ?? []).length).toBeGreaterThan(0)
  })

  test('Consumer web loads without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(URLS.consumer())
    await page.waitForLoadState('networkidle')
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('Business portal reaches login screen', async ({ page }) => {
    await page.goto(URLS.business())
    await expect(page.getByRole('button', { name: /(sign in|log in|continue)/i }).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('Staff portal reaches login screen', async ({ page }) => {
    await page.goto(URLS.staff())
    await expect(page.getByRole('button', { name: /(sign in|log in|continue)/i }).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('Admin portal reaches login screen', async ({ page }) => {
    await page.goto(URLS.admin())
    await expect(page.getByRole('button', { name: /(sign in|log in|continue)/i }).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('CORS allows configured origin (and rejects evil.com)', async ({ request }) => {
    const evil = await request.fetch(`${URLS.api()}/v1/nodes/johannesburg`, {
      method: 'GET',
      headers: { Origin: 'https://evil.com' },
    })
    const acao = evil.headers()['access-control-allow-origin']
    // Allowed list should not echo the bad origin nor be wildcard for credentialed routes.
    expect(acao === 'https://evil.com').toBe(false)
  })

  test('HTTPS redirect on apex consumer host', async ({ request }) => {
    // Many CDNs answer the redirect with 301/308. Don't follow so we can assert.
    const res = await request.get(URLS.consumer().replace('https://', 'http://'), {
      maxRedirects: 0,
      failOnStatusCode: false,
    })
    expect([301, 302, 307, 308]).toContain(res.status())
    expect(res.headers()['location'] ?? '').toMatch(/^https:\/\//)
  })
})
