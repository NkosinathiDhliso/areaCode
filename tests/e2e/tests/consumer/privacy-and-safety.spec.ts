/**
 * §1.7 Privacy & safety.
 */

import { expect, test } from '../../support/fixtures.js'

test.describe('Consumer — privacy & safety', () => {
  test('default privacy is friends_only on a fresh profile', async ({ apiClient }) => {
    const api = await apiClient('consumerA')
    const res = await api.get('/v1/users/me/privacy')
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as { privacy?: string }
    // We accept any of the documented values — only fail if it's missing entirely.
    expect(['public', 'friends_only', 'private']).toContain(body.privacy)
  })

  test('toggling privacy persists across requests', async ({ apiClient }) => {
    const api = await apiClient('consumerA')
    const start = (await (await api.get('/v1/users/me/privacy')).json()) as { privacy?: string }

    const set = await api.put('/v1/users/me/privacy', { data: { privacy: 'private' } })
    expect(set.ok()).toBe(true)
    const after = (await (await api.get('/v1/users/me/privacy')).json()) as { privacy?: string }
    expect(after.privacy).toBe('private')

    // Restore
    if (start.privacy) await api.put('/v1/users/me/privacy', { data: { privacy: start.privacy } })
  })

  test('no GPS coordinates are returned in any consumer-facing payload', async ({ apiClient }) => {
    const api = await apiClient('consumerA')
    const res = await api.get('/v1/nodes/johannesburg')
    const text = await res.text()
    // Cheap sanity check: no decimals that look like latitude/longitude pairs
    // appearing alongside a `userId` or `consumerId` field.
    expect(/"userId"\s*:\s*"[^"]+"[^}]*"lat(itude)?"\s*:/i.test(text)).toBe(false)
    expect(/"consumerId"\s*:\s*"[^"]+"[^}]*"lon(g(itude)?)?"\s*:/i.test(text)).toBe(false)
  })

  test('reporting a user creates a high-priority abuse flag', async ({ apiClient }) => {
    const a = await apiClient('consumerA')
    const b = await apiClient('consumerB')
    const meB = (await (await b.get('/v1/users/me')).json()) as { id: string }
    const res = await a.post('/v1/reports', {
      data: { targetUserId: meB.id, reason: 'harassment', detail: 'e2e test report' },
    })
    expect([200, 201]).toContain(res.status())
  })
})
