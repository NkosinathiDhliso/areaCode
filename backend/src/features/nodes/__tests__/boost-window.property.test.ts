import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { boostWindowEnd, type BoostDuration } from '../../business/types.js'
import { isBoostActive } from '../boost.js'

/**
 * Property 5: Boost window read model.
 *
 * Two invariants of the paid Boost_Window (billing R5.2, R5.5):
 *   - Read model: `isBoostActive(boostUntil, now)` is true iff `boostUntil`
 *     parses to an instant strictly after `now`. An absent window is never
 *     active.
 *   - Max-merge: merging an overlapping purchase into an existing window
 *     (`max(existing, boostWindowEnd(paidAt, duration))`, the pure computation
 *     behind `setNodeBoostWindow`'s conditional write) never shortens the
 *     window. The merged end is no earlier than the existing end and always
 *     covers the newly purchased window.
 *
 * Validates: Requirements 5.3, 5.5
 */

// ISO ms UTC instants over a fixed-width year range (2000-2100), so
// lexicographic string comparison matches chronological order exactly - the
// same assumption `setNodeBoostWindow`'s conditional write relies on.
const MIN_MS = Date.parse('2000-01-01T00:00:00.000Z')
const MAX_MS = Date.parse('2100-01-01T00:00:00.000Z')
const msArb = fc.integer({ min: MIN_MS, max: MAX_MS })
const isoArb = msArb.map((ms) => new Date(ms).toISOString())
const durationArb: fc.Arbitrary<BoostDuration> = fc.constantFrom('2hr', '6hr', '24hr')

describe('Feature: billing-revenue-integrity, Property 5: boost window read model', () => {
  it('boostActive is true iff boostUntil is strictly after now', () => {
    fc.assert(
      fc.property(isoArb, msArb, (boostUntil, now) => {
        expect(isBoostActive(boostUntil, now)).toBe(Date.parse(boostUntil) > now)
      }),
      { numRuns: 200 },
    )
  })

  it('an absent boost window is never active', () => {
    fc.assert(
      fc.property(msArb, (now) => {
        expect(isBoostActive(null, now)).toBe(false)
        expect(isBoostActive(undefined, now)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  it('max-merge of an overlapping purchase never shortens the window', () => {
    fc.assert(
      fc.property(fc.option(isoArb, { nil: null }), isoArb, durationArb, (existing, paidAt, duration) => {
        const candidate = boostWindowEnd(paidAt, duration)
        // Mirror setNodeBoostWindow: keep the later instant (write only when the
        // new window ends later than the stored one).
        const merged = existing === null || existing < candidate ? candidate : existing

        // Never shortens: the merged window ends no earlier than the existing one.
        if (existing !== null) {
          expect(merged >= existing).toBe(true)
          expect(Date.parse(merged)).toBeGreaterThanOrEqual(Date.parse(existing))
        }
        // The merged window always covers the newly purchased window too.
        expect(Date.parse(merged)).toBeGreaterThanOrEqual(Date.parse(candidate))
      }),
      { numRuns: 200 },
    )
  })
})
