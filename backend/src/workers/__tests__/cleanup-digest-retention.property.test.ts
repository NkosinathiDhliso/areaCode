import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { DIGEST_RETENTION_MS, isDigestRowExpired } from '../cleanup.js'

/**
 * Feature: weekly-attribution-digest, Property (supporting): Digest_Row
 * 12-month retention boundary.
 *
 * This is NOT one of the design's four named correctness properties
 * (Properties 1-4 cover week arithmetic, metric conservation, honest copy,
 * and generation idempotence). It is a supporting property for the cleanup
 * worker's retention pass added by task 3.3.
 *
 * For any `Digest_Row` timestamp and `now` clock value, the row is deleted
 * by the cleanup worker if and only if
 * `(now - Date.parse(row.createdAt)) > DIGEST_RETENTION_MS`.
 *
 * The boundary is strict greater-than: a row whose `createdAt` equals
 * `nowMs - DIGEST_RETENTION_MS` exactly is NOT expired; one millisecond past
 * the boundary IS expired.
 *
 * Malformed timestamps (missing field, non-string, unparseable) all return
 * false so unknown timestamps are never deleted.
 *
 * Validates: Requirements 3.2
 */

// Wide ms range covering 1970-01-01 through ≈ 2286-11-20.
const msArb = fc.integer({ min: 0, max: 10_000_000_000_000 })

const malformedTimestampArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
  fc.boolean(),
  fc.constant([]),
  fc.constant({}),
  fc.constant(''),
  fc.constant('not a date'),
  fc.constant('garbage'),
  fc.constant('2026-99-99T99:99:99.999Z'),
)

describe('weekly-attribution-digest: Digest_Row retention boundary', () => {
  it('isDigestRowExpired(row, nowMs) iff nowMs - Date.parse(row.createdAt) > DIGEST_RETENTION_MS', () => {
    fc.assert(
      fc.property(msArb, msArb, (referenceMs, nowMs) => {
        const createdAt = new Date(referenceMs).toISOString()
        const expected = nowMs - referenceMs > DIGEST_RETENTION_MS
        expect(isDigestRowExpired({ createdAt }, nowMs)).toBe(expected)
      }),
      { numRuns: 100 },
    )
  })

  it('a row whose createdAt is exactly nowMs - DIGEST_RETENTION_MS returns false (strict greater-than)', () => {
    // nowMs bounded so nowMs - DIGEST_RETENTION_MS is a non-negative integer
    // that round-trips through Date.toISOString / Date.parse exactly.
    const nowAtBoundaryArb = fc.integer({
      min: DIGEST_RETENTION_MS,
      max: 10_000_000_000_000,
    })

    fc.assert(
      fc.property(nowAtBoundaryArb, (nowMs) => {
        const referenceMs = nowMs - DIGEST_RETENTION_MS
        const iso = new Date(referenceMs).toISOString()
        expect(Date.parse(iso)).toBe(referenceMs)
        expect(isDigestRowExpired({ createdAt: iso }, nowMs)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('one millisecond past the boundary returns true (strict greater-than)', () => {
    const nowPastBoundaryArb = fc.integer({
      min: DIGEST_RETENTION_MS + 1,
      max: 10_000_000_000_000,
    })

    fc.assert(
      fc.property(nowPastBoundaryArb, (nowMs) => {
        const referenceMs = nowMs - DIGEST_RETENTION_MS - 1
        const iso = new Date(referenceMs).toISOString()
        expect(Date.parse(iso)).toBe(referenceMs)
        expect(isDigestRowExpired({ createdAt: iso }, nowMs)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('malformed createdAt (missing, null, non-string, unparseable) returns false', () => {
    fc.assert(
      fc.property(malformedTimestampArb, msArb, (createdAt, nowMs) => {
        const row =
          createdAt === undefined ? ({} as { createdAt?: unknown }) : ({ createdAt } as { createdAt?: unknown })
        expect(isDigestRowExpired(row, nowMs)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})
