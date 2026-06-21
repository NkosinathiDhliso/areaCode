import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { rankGetsByVibe, pulseStateFromScore, type GetRankSignals } from '../ranking.js'

/**
 * Gets feed ranking — vibe-first ordering invariants.
 *
 * These tests lock the discovery-DNA law
 * (`.kiro/steering/discovery-dna-vibe-over-convenience.md`) for the consumer
 * Get_Feed: aliveness leads, taste sits above proximity, proximity is a mere
 * tiebreaker, payment never enters, and the order is deterministic. The same
 * pure function (`rankGetsByVibe`) is what the repository/service use to order
 * the feed, so these exercise real behaviour.
 */

const signalArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  aliveness: fc.double({ min: 0, max: 200, noNaN: true }),
  tasteMatch: fc.double({ min: 0, max: 1, noNaN: true }),
  distanceMeters: fc.double({ min: 0, max: 5000, noNaN: true }),
})

const uniqueByIdArb = fc
  .array(signalArb, { minLength: 1, maxLength: 30 })
  .map((arr) => arr.map((s, i) => ({ ...s, id: `${s.id}-${i}` })))

describe('rankGetsByVibe — vibe-first ordering', () => {
  it('never lets a closer-but-deader get outrank a more-alive one', () => {
    fc.assert(
      fc.property(uniqueByIdArb, (gets) => {
        const ranked = rankGetsByVibe(gets)
        for (let i = 0; i < ranked.length - 1; i++) {
          const a = ranked[i]!
          const b = ranked[i + 1]!
          // The one ranked earlier must never be strictly LESS alive than the
          // one after it — proximity/taste can only break ties, never invert.
          expect(a.aliveness).toBeGreaterThanOrEqual(b.aliveness)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('among equally-alive gets, never ranks a worse taste match above a better one', () => {
    fc.assert(
      fc.property(uniqueByIdArb, (gets) => {
        const ranked = rankGetsByVibe(gets)
        for (let i = 0; i < ranked.length - 1; i++) {
          const a = ranked[i]!
          const b = ranked[i + 1]!
          if (a.aliveness === b.aliveness) {
            expect(a.tasteMatch).toBeGreaterThanOrEqual(b.tasteMatch)
          }
        }
      }),
      { numRuns: 200 },
    )
  })

  it('proximity only breaks ties between gets of equal aliveness AND taste', () => {
    fc.assert(
      fc.property(uniqueByIdArb, (gets) => {
        const ranked = rankGetsByVibe(gets)
        for (let i = 0; i < ranked.length - 1; i++) {
          const a = ranked[i]!
          const b = ranked[i + 1]!
          if (a.aliveness === b.aliveness && a.tasteMatch === b.tasteMatch) {
            expect(a.distanceMeters).toBeLessThanOrEqual(b.distanceMeters)
          }
        }
      }),
      { numRuns: 200 },
    )
  })

  it('a buzzing-but-further get beats a quiet-but-closer one (the headline rule)', () => {
    const alive: GetRankSignals = { id: 'alive', aliveness: 95, tasteMatch: 0, distanceMeters: 3000 }
    const close: GetRankSignals = { id: 'close', aliveness: 10, tasteMatch: 0, distanceMeters: 50 }
    const ranked = rankGetsByVibe([close, alive])
    expect(ranked[0]!.id).toBe('alive')
  })

  it('is deterministic and total — same input, same order; no items lost', () => {
    fc.assert(
      fc.property(uniqueByIdArb, (gets) => {
        const a = rankGetsByVibe(gets).map((g) => g.id)
        const b = rankGetsByVibe(gets).map((g) => g.id)
        expect(a).toEqual(b)
        expect([...a].sort()).toEqual([...gets.map((g) => g.id)].sort())
      }),
      { numRuns: 100 },
    )
  })

  it('does not mutate the input array', () => {
    const gets: GetRankSignals[] = [
      { id: 'a', aliveness: 1, tasteMatch: 0, distanceMeters: 100 },
      { id: 'b', aliveness: 2, tasteMatch: 0, distanceMeters: 200 },
    ]
    const snapshot = gets.map((g) => g.id)
    rankGetsByVibe(gets)
    expect(gets.map((g) => g.id)).toEqual(snapshot)
  })
})

describe('pulseStateFromScore — band mapping', () => {
  it('maps scores to the same bands the map uses', () => {
    expect(pulseStateFromScore(0)).toBe('dormant')
    expect(pulseStateFromScore(5)).toBe('quiet')
    expect(pulseStateFromScore(20)).toBe('active')
    expect(pulseStateFromScore(45)).toBe('buzzing')
    expect(pulseStateFromScore(80)).toBe('popping')
  })
})
