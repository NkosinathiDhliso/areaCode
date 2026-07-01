import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'

import { staffRoutes } from '../handler.js'

/**
 * Portal Hardening item E — staff surface route-table assertion.
 *
 * Task 5.4 backend half. Registers ONLY the staff router into a fresh Fastify
 * instance and inspects every route it declares through an `onRoute` hook.
 * This proves, structurally, that the unused First-Get preview route removed
 * in task 5.1 is gone:
 *
 *   GET /v1/staff/first-get/:rewardId/preview   ← must be ABSENT
 *
 * It also guards the routes that must remain: the still-used redeem preview
 * (a different endpoint) and the First-Get confirm/list paths.
 *
 * **Validates: Requirements 5.1**
 */

interface CollectedRoute {
  method: string
  url: string
}

/** Build a fresh Fastify instance with ONLY the staff router registered,
 *  collecting every route it declares through an onRoute hook. */
async function collectStaffRoutes(): Promise<CollectedRoute[]> {
  const app = Fastify()
  const routes: CollectedRoute[] = []

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      routes.push({ method: String(method).toUpperCase(), url: route.url })
    }
  })

  await app.register(staffRoutes)
  await app.ready()
  await app.close()

  return routes
}

describe('staff router — First-Get preview route removed (R5.1)', () => {
  it('does not register GET /v1/staff/first-get/:rewardId/preview', async () => {
    const routes = await collectStaffRoutes()

    const signatures = routes.filter((r) => r.method !== 'HEAD').map((r) => `${r.method} ${r.url}`)

    expect(signatures).not.toContain('GET /v1/staff/first-get/:rewardId/preview')

    // No first-get route may carry a "preview" segment at all.
    const firstGetPreview = routes.filter((r) => /first-get/i.test(r.url) && /preview/i.test(r.url))
    expect(firstGetPreview).toHaveLength(0)
  })

  it('keeps the still-used routes: redeem preview and First-Get confirm/list', async () => {
    const routes = await collectStaffRoutes()

    const signatures = new Set(routes.filter((r) => r.method !== 'HEAD').map((r) => `${r.method} ${r.url}`))

    // The redeem preview is a distinct, still-used endpoint — not removed.
    expect(signatures).toContain('GET /v1/staff/redeem/:code/preview')
    // The First-Get issuer flow is load -> confirm; both survive.
    expect(signatures).toContain('GET /v1/staff/first-get')
    expect(signatures).toContain('POST /v1/staff/first-get/:rewardId/confirm')
  })
})
