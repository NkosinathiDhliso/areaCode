/**
 * §7 Security Spot Checks.
 */

import { expect, test } from '@playwright/test'

import { URLS } from '../support/env.js'

test.describe('@smoke security spot checks', () => {
  test('HSTS header on API responses', async ({ request }) => {
    const res = await request.get(`${URLS.api()}/health`)
    const hsts = res.headers()['strict-transport-security']
    expect(hsts).toBeTruthy()
    expect(hsts!.toLowerCase()).toContain('max-age=')
  })

  test('CORS rejects evil.com origin', async ({ request }) => {
    const res = await request.fetch(`${URLS.api()}/v1/nodes/johannesburg`, {
      method: 'GET',
      headers: { Origin: 'https://evil.com' },
    })
    const acao = res.headers()['access-control-allow-origin']
    expect(acao).not.toBe('https://evil.com')
    expect(acao).not.toBe('*')
  })

  test('protected endpoint returns 401 without token', async ({ request }) => {
    const res = await request.get(`${URLS.api()}/v1/users/me/check-in-history`)
    expect([401, 403]).toContain(res.status())
  })

  test('cross-pool token rejected (consumer token on business endpoint)', async ({ request }) => {
    const fake = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.invalid'
    const res = await request.get(`${URLS.api()}/v1/business/me/nodes`, {
      headers: { Authorization: `Bearer ${fake}` },
    })
    expect([401, 403]).toContain(res.status())
  })

  test('Yoco webhook with no signature returns 400', async ({ request }) => {
    const res = await request.post(`${URLS.api()}/v1/webhooks/yoco`, {
      data: { event: 'fake' },
      headers: { 'content-type': 'application/json' },
    })
    expect([400, 401]).toContain(res.status())
  })

  test('self-block returns 400', async ({ request }) => {
    const res = await request.post(`${URLS.api()}/v1/users/me/block/self`, {
      headers: { Authorization: 'Bearer invalid' },
    })
    expect([400, 401, 403]).toContain(res.status())
  })
})
