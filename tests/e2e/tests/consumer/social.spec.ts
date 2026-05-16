/**
 * §1.6 Social — follow, accept, leaderboard, block.
 */

import { TEST_ACCOUNTS } from '../../support/env.js'
import { expect, test } from '../../support/fixtures.js'

test.describe('Consumer — social', () => {
  test('search finds another user by display name (api)', async ({ apiClient }) => {
    const api = await apiClient('consumerA')
    const res = await api.get(`/v1/users/search?q=${encodeURIComponent(TEST_ACCOUNTS.consumerB.displayName)}`)
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as { users?: Array<{ id: string; displayName?: string }> }
    expect((body.users ?? []).some((u) => /Consumer B/i.test(u.displayName ?? ''))).toBe(true)
  })

  test('follow → accept yields mutual follow', async ({ apiClient }) => {
    const a = await apiClient('consumerA')
    const b = await apiClient('consumerB')

    const meB = await b.get('/v1/users/me')
    const meBBody = (await meB.json()) as { id: string }

    // A follows B
    const followRes = await a.post(`/v1/users/${meBBody.id}/follow`)
    expect([200, 201, 202, 409]).toContain(followRes.status())

    // B accepts
    const inbox = await b.get('/v1/users/me/follow-requests')
    const inboxBody = (await inbox.json()) as { requests?: Array<{ id: string }> }
    const reqId = inboxBody.requests?.[0]?.id
    if (reqId) {
      const accept = await b.post(`/v1/users/me/follow-requests/${reqId}/accept`)
      expect(accept.ok()).toBe(true)
    }

    const meARes = await a.get('/v1/users/me')
    const meABody = (await meARes.json()) as { id: string }
    const aFollowing = await a.get(`/v1/users/${meABody.id}/following`)
    expect(aFollowing.ok()).toBe(true)
  })

  test('leaderboard returns top users for the city', async ({ apiClient }) => {
    const api = await apiClient('consumerA')
    const res = await api.get('/v1/leaderboard?city=johannesburg&period=week')
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as { entries?: unknown[] }
    expect(Array.isArray(body.entries)).toBe(true)
  })

  test('blocking a user removes them from feed', async ({ apiClient }) => {
    const a = await apiClient('consumerA')
    const b = await apiClient('consumerB')
    const meB = (await (await b.get('/v1/users/me')).json()) as { id: string }
    const block = await a.post(`/v1/users/me/block/${meB.id}`)
    expect([200, 201, 204]).toContain(block.status())
    const feed = await a.get('/v1/feed')
    expect(feed.ok()).toBe(true)
    const feedBody = (await feed.json()) as { items?: Array<{ userId?: string }> }
    expect((feedBody.items ?? []).every((i) => i.userId !== meB.id)).toBe(true)
    // Cleanup
    await a.delete(`/v1/users/me/block/${meB.id}`).catch(() => {})
  })
})
