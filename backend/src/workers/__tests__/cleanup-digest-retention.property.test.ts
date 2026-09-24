import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { RETENTION_TWELVE_MONTHS_MS, isBoostScoreboardCacheExpired, isDigestRowExpired } from '../cleanup.js'

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
 * `(now - Date.parse(row.createdAt)) > RETENTION_TWELVE_MONTHS_MS`.
 *
 * The boundary is strict greater-than: a row whose `createdAt` equals
 * `nowMs - RETENTION_TWELVE_MONTHS_MS` exactly is NOT expired; one millisecond past
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
  it('isDigestRowExpired(row, nowMs) iff nowMs - Date.parse(row.createdAt) > RETENTION_TWELVE_MONTHS_MS', () => {
    fc.assert(
      fc.property(msArb, msArb, (referenceMs, nowMs) => {
        const createdAt = new Date(referenceMs).toISOString()
        const expected = nowMs - referenceMs > RETENTION_TWELVE_MONTHS_MS
        expect(isDigestRowExpired({ createdAt }, nowMs)).toBe(expected)
      }),
      { numRuns: 100 },
    )
  })

  it('a row whose createdAt is exactly nowMs - RETENTION_TWELVE_MONTHS_MS returns false (strict greater-than)', () => {
    // nowMs bounded so nowMs - RETENTION_TWELVE_MONTHS_MS is a non-negative integer
    // that round-trips through Date.toISOString / Date.parse exactly.
    const nowAtBoundaryArb = fc.integer({
      min: RETENTION_TWELVE_MONTHS_MS,
      max: 10_000_000_000_000,
    })

    fc.assert(
      fc.property(nowAtBoundaryArb, (nowMs) => {
        const referenceMs = nowMs - RETENTION_TWELVE_MONTHS_MS
        const iso = new Date(referenceMs).toISOString()
        expect(Date.parse(iso)).toBe(referenceMs)
        expect(isDigestRowExpired({ createdAt: iso }, nowMs)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('one millisecond past the boundary returns true (strict greater-than)', () => {
    const nowPastBoundaryArb = fc.integer({
      min: RETENTION_TWELVE_MONTHS_MS + 1,
      max: 10_000_000_000_000,
    })

    fc.assert(
      fc.property(nowPastBoundaryArb, (nowMs) => {
        const referenceMs = nowMs - RETENTION_TWELVE_MONTHS_MS - 1
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

/**
 * Feature: proof-of-demand (R7.2), supporting property: the closed-window
 * Boost_Scoreboard cache row shares the Digest_Row 12-month horizon.
 *
 * The cache row is written by `boost-scoreboard-read.ts` through `kvSet`,
 * which stamps `updatedAt` and deliberately no `ttl`, so the cleanup worker
 * owns its expiry. Same strict greater-than boundary, and the digest
 * predicate must not fire on it (it has no `createdAt`), so the two sweeps
 * cannot cross-delete.
 *
 * Validates: Requirements 7.2
 */
describe('proof-of-demand: Boost_Scoreboard cache retention boundary', () => {
  it('isBoostScoreboardCacheExpired(row, nowMs) iff nowMs - Date.parse(row.updatedAt) > RETENTION_TWELVE_MONTHS_MS', () => {
    fc.assert(
      fc.property(msArb, msArb, (referenceMs, nowMs) => {
        const updatedAt = new Date(referenceMs).toISOString()
        const expected = nowMs - referenceMs > RETENTION_TWELVE_MONTHS_MS
        expect(isBoostScoreboardCacheExpired({ updatedAt }, nowMs)).toBe(expected)
      }),
      { numRuns: 100 },
    )
  })

  it('the boundary is strict greater-than in both directions', () => {
    const nowArb = fc.integer({ min: RETENTION_TWELVE_MONTHS_MS + 1, max: 10_000_000_000_000 })
    fc.assert(
      fc.property(nowArb, (nowMs) => {
        const atBoundary = new Date(nowMs - RETENTION_TWELVE_MONTHS_MS).toISOString()
        const pastBoundary = new Date(nowMs - RETENTION_TWELVE_MONTHS_MS - 1).toISOString()
        expect(isBoostScoreboardCacheExpired({ updatedAt: atBoundary }, nowMs)).toBe(false)
        expect(isBoostScoreboardCacheExpired({ updatedAt: pastBoundary }, nowMs)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('malformed updatedAt returns false, and the digest predicate never fires on a cache row', () => {
    fc.assert(
      fc.property(malformedTimestampArb, msArb, (updatedAt, nowMs) => {
        const row =
          updatedAt === undefined ? ({} as { updatedAt?: unknown }) : ({ updatedAt } as { updatedAt?: unknown })
        expect(isBoostScoreboardCacheExpired(row, nowMs)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('the two 12-month predicates read different fields, so neither deletes the other row type', () => {
    fc.assert(
      fc.property(msArb, msArb, (referenceMs, nowMs) => {
        const iso = new Date(referenceMs).toISOString()
        // A cache row (updatedAt only) is invisible to the digest predicate.
        expect(isDigestRowExpired({ updatedAt: iso } as { createdAt?: unknown }, nowMs)).toBe(false)
        // A Digest_Row (createdAt only) is invisible to the cache predicate.
        expect(isBoostScoreboardCacheExpired({ createdAt: iso } as { updatedAt?: unknown }, nowMs)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})
