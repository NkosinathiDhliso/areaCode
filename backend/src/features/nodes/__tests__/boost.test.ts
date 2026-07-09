import { describe, it, expect } from 'vitest'

import { isBoostActive } from '../boost.js'

/**
 * Boost_Window read model (billing R5.2, R5.5).
 *
 * `boostActive = boostUntil > now`, computed at read time. These examples pin
 * the honest edges: no boost reads false, a future window reads true, and a
 * lapsed window reverts to false with no residue (no expiry worker involved).
 */
describe('isBoostActive', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z')

  it('returns false when no boost has ever been purchased', () => {
    expect(isBoostActive(null, now)).toBe(false)
    expect(isBoostActive(undefined, now)).toBe(false)
  })

  it('returns true while the window is still in the future', () => {
    expect(isBoostActive('2026-07-09T18:00:00.000Z', now)).toBe(true)
  })

  it('returns false once the window has passed (reverts with no residue)', () => {
    expect(isBoostActive('2026-07-09T06:00:00.000Z', now)).toBe(false)
  })

  it('returns false at the exact boundary (strictly greater than now)', () => {
    expect(isBoostActive('2026-07-09T12:00:00.000Z', now)).toBe(false)
  })

  it('returns false for an unparseable instant', () => {
    expect(isBoostActive('not-a-date', now)).toBe(false)
  })
})
