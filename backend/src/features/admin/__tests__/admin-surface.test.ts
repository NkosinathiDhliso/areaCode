import Fastify from 'fastify'
import { describe, it, expect } from 'vitest'

import { adminRoutes } from '../handler.js'

/**
 * Portal Hardening item D — admin surface route-table assertions.
 *
 * Task 4.3 surfacing tests, backend half. Registers ONLY the admin router
 * into a fresh Fastify instance and inspects every route it declares through
 * an `onRoute` hook. This proves, structurally:
 *
 *  - The four detail reads surfaced in task 4.1 exist and stay reachable
 *    (the admin-app drill-downs call them): user detail, user check-ins,
 *    business detail, and per-user consent history.
 *  - The reconsent routes were deduplicated (task 4.2): exactly one reconsent
 *    route remains in the table — `export-reconsent`, the survivor with the
 *    live caller (ConsentAudit.tsx) — and the retired `reconsent-list` route
 *    is absent.
 *
 * **Validates: Requirements 4.1, 4.5**
 */

interface CollectedRoute {
  method: string
  url: string
}

/** Build a fresh Fastify instance with ONLY the admin router registered,
 *  collecting every route it declares through an onRoute hook. */
async function collectAdminRoutes(): Promise<CollectedRoute[]> {
  const app = Fastify()
  const routes: CollectedRoute[] = []

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      routes.push({ method: String(method).toUpperCase(), url: route.url })
    }
  })

  await app.register(adminRoutes)
  await app.ready()
  await app.close()

  return routes
}

describe('admin router — surfaced detail reads (R4.1)', () => {
  it('registers the four detail reads that the admin-app drill-downs call', async () => {
    const routes = await collectAdminRoutes()
    const getUrls = new Set(routes.filter((r) => r.method === 'GET').map((r) => r.url))

    // ConsumerDetailPanel issues these three reads.
    expect(getUrls).toContain('/v1/admin/users/:userId')
    expect(getUrls).toContain('/v1/admin/users/:userId/check-ins')
    expect(getUrls).toContain('/v1/admin/consent/:userId')

    // BusinessDetailPanel issues this read.
    expect(getUrls).toContain('/v1/admin/businesses/:businessId')
  })

  it('registers the Grace_List endpoint as a static route (cross-portal R2.2)', async () => {
    const routes = await collectAdminRoutes()
    const getUrls = new Set(routes.filter((r) => r.method === 'GET').map((r) => r.url))
    // Static /grace must be present and distinct from the parametric detail read,
    // so it is not shadowed by :businessId (uuid) validation.
    expect(getUrls).toContain('/v1/admin/businesses/grace')
    expect(getUrls).toContain('/v1/admin/businesses/:businessId')
  })
})

describe('admin router — reconsent deduplicated (R4.5)', () => {
  it('keeps exactly one reconsent route (export-reconsent), and reconsent-list is gone', async () => {
    const routes = await collectAdminRoutes()

    const reconsentRoutes = routes.filter((r) => r.method !== 'HEAD' && /reconsent/i.test(r.url))

    // Exactly one reconsent route survives the dedupe.
    expect(reconsentRoutes).toHaveLength(1)

    // The survivor is the one with the live admin-app caller.
    expect(reconsentRoutes[0]?.url).toBe('/v1/admin/consent/export-reconsent')

    // The retired duplicate is absent from the route table.
    const allUrls = routes.map((r) => r.url)
    expect(allUrls.some((url) => url.includes('reconsent-list'))).toBe(false)
  })
})
