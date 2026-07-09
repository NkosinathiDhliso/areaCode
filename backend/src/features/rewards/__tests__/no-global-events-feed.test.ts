import Fastify from 'fastify'
import { describe, it, expect } from 'vitest'

import { rewardRoutes } from '../handler.js'

/**
 * Event & Offer Gets — no-new-reach regression test.
 *
 * Covers Property 6 (No new reach surface, structural) from the design doc.
 * The monetization invariant (Requirement 5) is that a get is a free
 * engagement tool and reach is the paid product. Concretely, the rewards
 * router must NOT expose any consumer-facing route that lists or searches
 * events/offers independent of proximity. The only consumer read path is the
 * existing proximity-gated `GET /v1/rewards/near-me` (plus the user's own
 * `GET /v1/users/me/unclaimed-rewards` wallet). The operator-scoped
 * `GET /v1/business/rewards` lives in the business feature router, not here.
 *
 * This test registers ONLY the rewards router and inspects every route it
 * declares via an `onRoute` hook, so if anyone later adds a consumer
 * events-list / search GET to the rewards router, this test fails.
 *
 * **Validates: Requirements 5.1, 5.2**
 */

interface CollectedRoute {
  method: string
  url: string
}

/** Build a fresh Fastify instance with ONLY the rewards router registered,
 *  collecting every route it declares through an onRoute hook. */
async function collectRewardRoutes(): Promise<CollectedRoute[]> {
  const app = Fastify()
  const routes: CollectedRoute[] = []

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      routes.push({ method: String(method).toUpperCase(), url: route.url })
    }
  })

  await app.register(rewardRoutes)
  await app.ready()
  await app.close()

  return routes
}

describe('rewards router — no new reach surface (R5.1, R5.2)', () => {
  it('registers exactly the known rewards routes and no others', async () => {
    const routes = await collectRewardRoutes()

    // Normalise to a comparable "METHOD url" set (HEAD is auto-added by
    // Fastify for GET routes, so we ignore it).
    const signatures = new Set(routes.filter((r) => r.method !== 'HEAD').map((r) => `${r.method} ${r.url}`))

    // The complete, intended surface of the rewards router. Any addition or
    // removal here is a deliberate decision that must update this test.
    const expected = new Set([
      'POST /v1/business/rewards',
      'PUT /v1/business/rewards/:id',
      // Operator-scoped read (view_rewards, business/staff auth) backing the
      // threshold-change confirm dialog (Churn-defences R1.7). Not a consumer
      // reach surface: it returns a grandfathered-lock count for one owned
      // reward, gated by ownership, never lists or ranks gets.
      'GET /v1/business/rewards/:id/lock-count',
      'GET /v1/rewards/near-me',
      'GET /v1/users/me/unclaimed-rewards',
      'POST /v1/rewards/:id/redeem',
    ])

    expect(signatures).toEqual(expected)
  })

  it('exposes the proximity-gated near-me feed as the only consumer events read path', async () => {
    const routes = await collectRewardRoutes()
    const getUrls = routes.filter((r) => r.method === 'GET').map((r) => r.url)

    // Positive guard: the proximity-gated feed MUST exist. It is the only
    // path through which a consumer discovers gets, and it is bounded by the
    // near-me radius — so events inherit that bound (R5.1).
    expect(getUrls).toContain('/v1/rewards/near-me')

    // The only other consumer GET is the user's own wallet of unclaimed
    // rewards — not a discovery/listing surface.
    const consumerGetUrls = getUrls.filter((url) => !url.startsWith('/v1/business/'))
    expect(new Set(consumerGetUrls)).toEqual(new Set(['/v1/rewards/near-me', '/v1/users/me/unclaimed-rewards']))
  })

  it('exposes no consumer-facing events list/search route', async () => {
    const routes = await collectRewardRoutes()
    const getUrls = routes.filter((r) => r.method === 'GET').map((r) => r.url)

    // No global/city-wide events feed, no events list, no search surface.
    // These are the shapes R5.2 forbids ("what's on tonight", unbounded
    // search, any non-proximity ranking).
    const forbiddenPatterns = [
      /events/i, // any route mentioning events
      /\/v1\/rewards\/search/i, // a rewards search surface
      /\/v1\/rewards\/all/i, // a bulk listing surface
      /\/v1\/rewards\/?$/i, // a bare consumer rewards list
      /whats-?on/i, // "what's on tonight"
      /\/v1\/offers/i, // an offers feed
    ]

    for (const url of getUrls) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(url),
          `rewards router must not expose a consumer events list/search route, but found GET ${url} matching ${pattern}`,
        ).toBe(false)
      }
    }
  })
})
