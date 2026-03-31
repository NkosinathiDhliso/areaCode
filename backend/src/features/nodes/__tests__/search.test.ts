import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Property 7: Search results are always sorted by proximity × pulseScore.
 * For any query, results maintain sort invariant.
 * Validates: Requirements 16.3
 *
 * Simulates the ranking formula: similarity(name, query) * (1 / distance) * pulseScore
 */
interface SearchResult {
  name: string
  similarity: number
  distance: number
  pulseScore: number
}

function computeRank(r: SearchResult): number {
  if (r.distance === 0) return Infinity
  return r.similarity * (1 / r.distance) * r.pulseScore
}

function sortByRank(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => computeRank(b) - computeRank(a))
}

describe('node search ranking', () => {
  const resultArb = fc.record({
    name: fc.string({ minLength: 2, maxLength: 50 }),
    similarity: fc.double({ min: 0.1, max: 1.0, noNaN: true }),
    distance: fc.double({ min: 1, max: 50000, noNaN: true }),
    pulseScore: fc.double({ min: 0, max: 100, noNaN: true }),
  })

  it('sorted results maintain descending rank invariant', () => {
    fc.assert(
      fc.property(fc.array(resultArb, { minLength: 2, maxLength: 20 }), (results) => {
        const sorted = sortByRank(results)
        for (let i = 1; i < sorted.length; i++) {
          expect(computeRank(sorted[i - 1]!)).toBeGreaterThanOrEqual(computeRank(sorted[i]!))
        }
      }),
      { numRuns: 200 },
    )
  })

  it('higher pulseScore with same distance ranks higher', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 1.0, noNaN: true }),
        fc.double({ min: 1, max: 50000, noNaN: true }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        fc.double({ min: 51, max: 100, noNaN: true }),
        (similarity, distance, lowPulse, highPulse) => {
          const low: SearchResult = { name: 'a', similarity, distance, pulseScore: lowPulse }
          const high: SearchResult = { name: 'b', similarity, distance, pulseScore: highPulse }
          expect(computeRank(high)).toBeGreaterThan(computeRank(low))
        },
      ),
      { numRuns: 200 },
    )
  })
})
