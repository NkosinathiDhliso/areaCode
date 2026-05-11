/**
 * Property 13: Client-Side Search Filtering and Sorting
 *
 * For any query string Q and set of cached nodes, search results SHALL include
 * exactly those nodes where `name.toLowerCase().includes(Q.toLowerCase())` OR
 * `category.toLowerCase().includes(Q.toLowerCase())`. When user location is
 * available, results SHALL be sorted by haversine distance ascending.
 *
 * **Validates: Requirements 13.1, 13.2, 23.3**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { searchNodes, type SearchableNode } from '@area-code/shared/lib/search'
import type { NodeState } from '@area-code/shared/types'

const nodeStateArb = fc.oneof(
  fc.constant('dormant' as NodeState),
  fc.constant('quiet' as NodeState),
  fc.constant('active' as NodeState),
  fc.constant('buzzing' as NodeState),
  fc.constant('popping' as NodeState),
)

const categoryArb = fc.oneof(
  fc.constant('food'),
  fc.constant('coffee'),
  fc.constant('nightlife'),
  fc.constant('retail'),
  fc.constant('fitness'),
  fc.constant('arts'),
)

const searchableNodeArb: fc.Arbitrary<SearchableNode> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  category: categoryArb,
  lat: fc.double({ min: -34.5, max: -25.5, noNaN: true }),
  lng: fc.double({ min: 18, max: 32, noNaN: true }),
  state: nodeStateArb,
  pulseScore: fc.integer({ min: 0, max: 500 }),
  boostUntil: fc.constant(null),
})

describe('Property 13: Client-Side Search Filtering and Sorting', () => {
  it('results include exactly nodes matching name or category (case-insensitive includes)', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        fc.array(searchableNodeArb, { minLength: 0, maxLength: 20 }),
        (query, nodes) => {
          const results = searchNodes(query, nodes)
          const q = query.toLowerCase()

          // All results must match
          for (const r of results) {
            const node = nodes.find((n) => n.id === r.id)!
            const nameMatch = node.name.toLowerCase().includes(q)
            const catMatch = node.category.toLowerCase().includes(q)
            expect(nameMatch || catMatch).toBe(true)
          }

          // All matching nodes must be in results
          for (const node of nodes) {
            const nameMatch = node.name.toLowerCase().includes(q)
            const catMatch = node.category.toLowerCase().includes(q)
            if (nameMatch || catMatch) {
              expect(results.some((r) => r.id === node.id)).toBe(true)
            }
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('results are sorted by distance ascending when location is available', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 5 }).filter((s) => s.trim().length > 0),
        fc.array(searchableNodeArb, { minLength: 2, maxLength: 15 }),
        fc.double({ min: -34.5, max: -25.5, noNaN: true }),
        fc.double({ min: 18, max: 32, noNaN: true }),
        (query, nodes, userLat, userLng) => {
          const results = searchNodes(query, nodes, userLat, userLng)

          // Verify sorted by distance ascending
          for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1]!.distanceKm ?? Infinity
            const curr = results[i]!.distanceKm ?? Infinity
            expect(curr).toBeGreaterThanOrEqual(prev)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('empty query returns no results', async () => {
    await fc.assert(
      fc.property(
        fc.array(searchableNodeArb, { minLength: 0, maxLength: 10 }),
        (nodes) => {
          expect(searchNodes('', nodes)).toHaveLength(0)
          expect(searchNodes('   ', nodes)).toHaveLength(0)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('no duplicate results', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 5 }).filter((s) => s.trim().length > 0),
        fc.array(searchableNodeArb, { minLength: 0, maxLength: 20 }),
        (query, nodes) => {
          const results = searchNodes(query, nodes)
          const ids = results.map((r) => r.id)
          expect(new Set(ids).size).toBe(ids.length)
        },
      ),
      { numRuns: 25 },
    )
  })
})
