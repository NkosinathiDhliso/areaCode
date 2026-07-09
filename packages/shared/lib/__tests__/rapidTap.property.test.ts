/**
 * Property tests for the pure rapid-tap (tap-burst) detector
 * (`createRapidTapDetector`, design D5, Requirement 4.1/4.2/4.7).
 *
 *  - Property 1: Threshold fires exactly at N fast taps - given N consecutive
 *    taps each within `gapMs` of the previous, the first N-1 taps return
 *    `false` and the Nth returns `true` (fires exactly on the Nth, never
 *    before).
 *  - Property 2: Any gap > gapMs resets the count - a tap slower than `gapMs`
 *    restarts the count at one, so a full fresh burst of N taps is required to
 *    fire afterwards.
 *  - Property 3: Post-fire state is fully reset - after firing, the detector
 *    behaves like a new one: it takes another complete N-tap burst to fire
 *    again (a single follow-up tap never re-fires).
 *  - Property 4: Monotonic time is non-strict (equal timestamps allowed) -
 *    taps sharing the same clock reading (delta 0 <= gapMs, including
 *    gapMs === 0) still count as consecutive and fire on the Nth.
 *
 * Time is injected through a mutable clock the test controls, so the logic is
 * exercised deterministically with no real timers.
 *
 * Validates: Requirements 4.7
 */
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { createRapidTapDetector } from '../rapidTap'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Drives a fresh detector with a mutable injected clock. `deltas[i]` is the
 * number of milliseconds the clock advances *before* the (i+1)th tap. Returns
 * the boolean result of every `tap()` call, in order.
 */
function runTaps(taps: number, gapMs: number, deltas: readonly number[]): boolean[] {
  let clock = 0
  const detector = createRapidTapDetector({ taps, gapMs, now: () => clock })
  const results: boolean[] = []
  for (const delta of deltas) {
    clock += delta
    results.push(detector.tap())
  }
  return results
}

// ─── Property 1: threshold fires exactly at N fast taps ──────────────────────

describe('Feature: rank-prestige, Property 1: threshold fires exactly at N fast taps', () => {
  it('the first N-1 fast taps return false and the Nth returns true', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 12, maxLength: 12 }),
        (taps, gapMs, rawGaps) => {
          // Each tap after the first lands within gapMs of the previous one.
          const deltas = [0]
          for (let i = 1; i < taps; i++) {
            deltas.push(gapMs === 0 ? 0 : rawGaps[i] % (gapMs + 1))
          }
          const results = runTaps(taps, gapMs, deltas)
          for (let i = 0; i < taps - 1; i++) {
            expect(results[i]).toBe(false)
          }
          expect(results[taps - 1]).toBe(true)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ─── Property 2: any gap > gapMs resets the count ────────────────────────────

describe('Feature: rank-prestige, Property 2: any gap > gapMs resets the count', () => {
  it('a tap slower than gapMs restarts the burst so a full N-tap burst is needed to fire', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 100_000 }),
        (taps, gapMs, primerCount, slowExtra) => {
          let clock = 0
          const detector = createRapidTapDetector({ taps, gapMs, now: () => clock })

          // Some fast taps that do not reach the threshold (primerCount < taps).
          const primers = Math.min(primerCount, taps - 1)
          for (let i = 0; i < primers; i++) {
            expect(detector.tap()).toBe(false)
          }

          // A tap strictly slower than gapMs resets the count to one.
          clock += gapMs + slowExtra
          expect(detector.tap()).toBe(false)

          // After the reset it takes exactly N-1 more fast taps to fire.
          for (let i = 0; i < taps - 2; i++) {
            expect(detector.tap()).toBe(false)
          }
          expect(detector.tap()).toBe(true)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ─── Property 3: post-fire state is fully reset ──────────────────────────────

describe('Feature: rank-prestige, Property 3: post-fire state is fully reset', () => {
  it('after firing, another complete N-tap burst is required to fire again', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 4 }),
        (taps, gapMs, bursts) => {
          let clock = 0
          const detector = createRapidTapDetector({ taps, gapMs, now: () => clock })

          for (let b = 0; b < bursts; b++) {
            for (let i = 0; i < taps - 1; i++) {
              // Advance within gapMs to stay a fast tap.
              clock += gapMs
              expect(detector.tap()).toBe(false)
            }
            clock += gapMs
            expect(detector.tap()).toBe(true)
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ─── Property 4: monotonic time is non-strict (equal timestamps allowed) ─────

describe('Feature: rank-prestige, Property 4: equal timestamps count as consecutive', () => {
  it('N taps sharing one clock reading (delta 0 <= gapMs) fire on the Nth', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 0, max: 100_000 }), (taps, gapMs) => {
        // Clock never advances: every tap has delta 0, which is <= gapMs even
        // when gapMs === 0, so all taps are consecutive.
        const deltas = new Array<number>(taps).fill(0)
        const results = runTaps(taps, gapMs, deltas)
        for (let i = 0; i < taps - 1; i++) {
          expect(results[i]).toBe(false)
        }
        expect(results[taps - 1]).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})
