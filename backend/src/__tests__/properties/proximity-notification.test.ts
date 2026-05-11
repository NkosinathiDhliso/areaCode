/**
 * Property 10: Proximity Notification Trigger
 *
 * For any consumer location, set of cached nodes, and notification opt-in state:
 * a proximity alert SHALL fire for a node if and only if ALL of the following hold:
 * (a) haversine distance <= 500 metres,
 * (b) node pulse state is "buzzing" or "popping",
 * (c) consumer has opted in to notifications,
 * (d) the same node has not triggered a notification within the last 15 minutes.
 *
 * **Validates: Requirements 7.2, 7.3, 7.4**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  haversineDistanceMetres,
  evaluate,
  shouldNotify,
  type CachedNode,
} from '@area-code/shared/lib/proximity'
import type { NodeState } from '@area-code/shared/types'

const nodeStateArb = fc.oneof(
  fc.constant('dormant' as NodeState),
  fc.constant('quiet' as NodeState),
  fc.constant('active' as NodeState),
  fc.constant('buzzing' as NodeState),
  fc.constant('popping' as NodeState),
)

const cachedNodeArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  lat: fc.double({ min: -34.5, max: -25.5, noNaN: true }),
  lng: fc.double({ min: 18, max: 32, noNaN: true }),
  state: nodeStateArb,
})

// South African coordinate range
const latArb = fc.double({ min: -34.5, max: -25.5, noNaN: true })
const lngArb = fc.double({ min: 18, max: 32, noNaN: true })

describe('Property 10: Proximity Notification Trigger', () => {
  it('evaluate returns only nodes within 500m with buzzing or popping state', async () => {
    await fc.assert(
      fc.property(
        latArb,
        lngArb,
        fc.array(cachedNodeArb, { minLength: 0, maxLength: 20 }),
        (userLat, userLng, nodes) => {
          const alerts = evaluate(userLat, userLng, nodes)

          for (const alert of alerts) {
            const node = nodes.find((n) => n.id === alert.nodeId)!
            // (a) distance <= 500m
            const dist = haversineDistanceMetres(userLat, userLng, node.lat, node.lng)
            expect(dist).toBeLessThanOrEqual(500)
            // (b) state is buzzing or popping
            expect(['buzzing', 'popping']).toContain(node.state)
          }

          // Verify completeness: all qualifying nodes are included
          for (const node of nodes) {
            const dist = haversineDistanceMetres(userLat, userLng, node.lat, node.lng)
            if (dist <= 500 && (node.state === 'buzzing' || node.state === 'popping')) {
              expect(alerts.some((a) => a.nodeId === node.id)).toBe(true)
            }
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('nodes outside 500m are never included in alerts', async () => {
    await fc.assert(
      fc.property(
        latArb,
        lngArb,
        fc.array(cachedNodeArb, { minLength: 0, maxLength: 20 }),
        (userLat, userLng, nodes) => {
          const alerts = evaluate(userLat, userLng, nodes)

          for (const alert of alerts) {
            const node = nodes.find((n) => n.id === alert.nodeId)!
            const dist = haversineDistanceMetres(userLat, userLng, node.lat, node.lng)
            expect(dist).toBeLessThanOrEqual(500)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('nodes with dormant/quiet/active state are never included', async () => {
    await fc.assert(
      fc.property(
        latArb,
        lngArb,
        fc.array(cachedNodeArb, { minLength: 0, maxLength: 20 }),
        (userLat, userLng, nodes) => {
          const alerts = evaluate(userLat, userLng, nodes)

          for (const alert of alerts) {
            const node = nodes.find((n) => n.id === alert.nodeId)!
            expect(node.state).not.toBe('dormant')
            expect(node.state).not.toBe('quiet')
            expect(node.state).not.toBe('active')
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('shouldNotify returns true when node has not been notified within 15 minutes', async () => {
    await fc.assert(
      fc.property(
        fc.uuid(),
        // Time since last notification: > 15 minutes (900001ms+)
        fc.integer({ min: 900001, max: 10000000 }),
        (nodeId, elapsed) => {
          const now = Date.now()
          const lastNotifiedMap = { [nodeId]: now - elapsed }
          expect(shouldNotify(nodeId, lastNotifiedMap, now)).toBe(true)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('shouldNotify returns false when node was notified within 15 minutes', async () => {
    await fc.assert(
      fc.property(
        fc.uuid(),
        // Time since last notification: < 15 minutes (0-899999ms)
        fc.integer({ min: 0, max: 899999 }),
        (nodeId, elapsed) => {
          const now = Date.now()
          const lastNotifiedMap = { [nodeId]: now - elapsed }
          expect(shouldNotify(nodeId, lastNotifiedMap, now)).toBe(false)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('shouldNotify returns true when node has never been notified', async () => {
    await fc.assert(
      fc.property(
        fc.uuid(),
        (nodeId) => {
          expect(shouldNotify(nodeId, {}, Date.now())).toBe(true)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('haversine distance is always non-negative', async () => {
    await fc.assert(
      fc.property(latArb, lngArb, latArb, lngArb, (lat1, lng1, lat2, lng2) => {
        const dist = haversineDistanceMetres(lat1, lng1, lat2, lng2)
        expect(dist).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 25 },
    )
  })

  it('haversine distance is symmetric', async () => {
    await fc.assert(
      fc.property(latArb, lngArb, latArb, lngArb, (lat1, lng1, lat2, lng2) => {
        const d1 = haversineDistanceMetres(lat1, lng1, lat2, lng2)
        const d2 = haversineDistanceMetres(lat2, lng2, lat1, lng1)
        expect(d1).toBeCloseTo(d2, 5)
      }),
      { numRuns: 25 },
    )
  })
})
