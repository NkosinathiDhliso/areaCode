import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import {
  RETENTION_YEARS_MS,
  isBoosterPurchaseExpired,
  isFloorChangeAuditExpired,
  isIdempotencyMarkerExpired,
} from '../cleanup.js'

/**
 * Property 9: Retention cleanup boundary.
 *
 * For any mixed corpus of `BoosterPurchase`, `Idempotency_Marker`, and
 * `Floor_Change_Audit_Row` rows with arbitrary timestamps and a `now`
 * clock value, each row is deleted by the cleanup worker if and only if
 * `(now - reference_timestamp) > RETENTION_YEARS_MS`, where
 * `reference_timestamp` is `paidAt` for `BoosterPurchase`, `createdAt`
 * for `Idempotency_Marker`, and `changedAt` for `Floor_Change_Audit_Row`.
 *
 * The boundary is strict greater-than: a row whose timestamp equals
 * `nowMs - RETENTION_YEARS_MS` exactly is NOT expired (R8.3, R8.6).
 *
 * Malformed timestamps (missing field, non-string, unparseable) all
 * return false so unknown timestamps are never deleted.
 *
 * Validates: Requirements 8.3, 8.6
 */

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Wide ms range covering 1970-01-01 through ≈ 2286-11-20. Sized so that
 * `nowMs - referenceMs` can land both well below and well above
 * RETENTION_YEARS_MS in either direction.
 */
const msArb = fc.integer({ min: 0, max: 10_000_000_000_000 })

/** ISO 8601 ms-precision UTC string round-tripped from an integer ms epoch. */
const isoMsArb = msArb.map((ms) => new Date(ms).toISOString())

/**
 * Produces values that are NOT a valid ISO 8601 ms-precision UTC string:
 *  - missing field (undefined) ── caller spreads {} into the row
 *  - explicit null
 *  - non-string scalars (number, boolean)
 *  - non-string objects (array, plain object)
 *  - unparseable strings
 *  - empty string
 */
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

// ─── Property 9.a: BoosterPurchase paidAt ───────────────────────────────────

describe('Property 9: retention cleanup boundary', () => {
  it('isBoosterPurchaseExpired(row, nowMs) iff nowMs - Date.parse(row.paidAt) > RETENTION_YEARS_MS', () => {
    fc.assert(
      fc.property(msArb, msArb, (referenceMs, nowMs) => {
        const paidAt = new Date(referenceMs).toISOString()
        const expected = nowMs - referenceMs > RETENTION_YEARS_MS
        expect(isBoosterPurchaseExpired({ paidAt }, nowMs)).toBe(expected)
      }),
      { numRuns: 200 },
    )
  })

  it('isFloorChangeAuditExpired(row, nowMs) iff nowMs - Date.parse(row.changedAt) > RETENTION_YEARS_MS', () => {
    fc.assert(
      fc.property(msArb, msArb, (referenceMs, nowMs) => {
        const changedAt = new Date(referenceMs).toISOString()
        const expected = nowMs - referenceMs > RETENTION_YEARS_MS
        expect(isFloorChangeAuditExpired({ changedAt }, nowMs)).toBe(expected)
      }),
      { numRuns: 200 },
    )
  })

  it('isIdempotencyMarkerExpired(row, nowMs) iff nowMs - Date.parse(row.createdAt) > RETENTION_YEARS_MS', () => {
    fc.assert(
      fc.property(msArb, msArb, (referenceMs, nowMs) => {
        const createdAt = new Date(referenceMs).toISOString()
        const expected = nowMs - referenceMs > RETENTION_YEARS_MS
        expect(isIdempotencyMarkerExpired({ createdAt }, nowMs)).toBe(expected)
      }),
      { numRuns: 200 },
    )
  })

  // ─── Property 9.b: strict greater-than boundary ─────────────────────────

  it('a row whose timestamp is exactly nowMs - RETENTION_YEARS_MS returns false (strict greater-than, R8.3)', () => {
    // nowMs is bounded so that nowMs - RETENTION_YEARS_MS is a non-negative
    // integer that round-trips through Date.toISOString / Date.parse.
    const nowAtBoundaryArb = fc.integer({
      min: RETENTION_YEARS_MS,
      max: 10_000_000_000_000,
    })

    fc.assert(
      fc.property(nowAtBoundaryArb, (nowMs) => {
        const referenceMs = nowMs - RETENTION_YEARS_MS
        const iso = new Date(referenceMs).toISOString()
        // Sanity: ms round-trip is exact for the integers we generate.
        expect(Date.parse(iso)).toBe(referenceMs)
        expect(isBoosterPurchaseExpired({ paidAt: iso }, nowMs)).toBe(false)
        expect(isFloorChangeAuditExpired({ changedAt: iso }, nowMs)).toBe(false)
        expect(isIdempotencyMarkerExpired({ createdAt: iso }, nowMs)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('one millisecond past the boundary returns true (strict greater-than, R8.3)', () => {
    const nowPastBoundaryArb = fc.integer({
      min: RETENTION_YEARS_MS + 1,
      max: 10_000_000_000_000,
    })

    fc.assert(
      fc.property(nowPastBoundaryArb, (nowMs) => {
        const referenceMs = nowMs - RETENTION_YEARS_MS - 1
        const iso = new Date(referenceMs).toISOString()
        expect(Date.parse(iso)).toBe(referenceMs)
        expect(isBoosterPurchaseExpired({ paidAt: iso }, nowMs)).toBe(true)
        expect(isFloorChangeAuditExpired({ changedAt: iso }, nowMs)).toBe(true)
        expect(isIdempotencyMarkerExpired({ createdAt: iso }, nowMs)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  // ─── Property 9.c: malformed timestamps ─────────────────────────────────

  it('malformed paidAt (missing, null, non-string, unparseable) returns false for BoosterPurchase', () => {
    fc.assert(
      fc.property(malformedTimestampArb, msArb, (paidAt, nowMs) => {
        // Spread an object so `undefined` results in a row without the field.
        const row =
          paidAt === undefined ? ({} as { paidAt?: unknown }) : ({ paidAt } as { paidAt?: unknown })
        expect(isBoosterPurchaseExpired(row, nowMs)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  it('malformed changedAt returns false for Floor_Change_Audit_Row', () => {
    fc.assert(
      fc.property(malformedTimestampArb, msArb, (changedAt, nowMs) => {
        const row =
          changedAt === undefined
            ? ({} as { changedAt?: unknown })
            : ({ changedAt } as { changedAt?: unknown })
        expect(isFloorChangeAuditExpired(row, nowMs)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  it('malformed createdAt returns false for Idempotency_Marker', () => {
    fc.assert(
      fc.property(malformedTimestampArb, msArb, (createdAt, nowMs) => {
        const row =
          createdAt === undefined
            ? ({} as { createdAt?: unknown })
            : ({ createdAt } as { createdAt?: unknown })
        expect(isIdempotencyMarkerExpired(row, nowMs)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  // ─── Property 9.d: mixed corpus dispatches by row type ──────────────────

  it('mixed corpus: each row is deleted iff (now - reference_timestamp) > RETENTION_YEARS_MS using its own field', () => {
    type CorpusRow =
      | { kind: 'purchase'; paidAt: string; referenceMs: number }
      | { kind: 'audit'; changedAt: string; referenceMs: number }
      | { kind: 'marker'; createdAt: string; referenceMs: number }

    const corpusRowArb: fc.Arbitrary<CorpusRow> = fc.oneof(
      msArb.map<CorpusRow>((referenceMs) => ({
        kind: 'purchase',
        paidAt: new Date(referenceMs).toISOString(),
        referenceMs,
      })),
      msArb.map<CorpusRow>((referenceMs) => ({
        kind: 'audit',
        changedAt: new Date(referenceMs).toISOString(),
        referenceMs,
      })),
      msArb.map<CorpusRow>((referenceMs) => ({
        kind: 'marker',
        createdAt: new Date(referenceMs).toISOString(),
        referenceMs,
      })),
    )

    fc.assert(
      fc.property(fc.array(corpusRowArb, { maxLength: 25 }), msArb, (corpus, nowMs) => {
        for (const row of corpus) {
          const expected = nowMs - row.referenceMs > RETENTION_YEARS_MS
          if (row.kind === 'purchase') {
            expect(isBoosterPurchaseExpired({ paidAt: row.paidAt }, nowMs)).toBe(expected)
            // Other-field predicates against this row see the wrong attribute
            // and must return false (no false-positive cross-deletion).
            expect(isFloorChangeAuditExpired(row as { changedAt?: unknown }, nowMs)).toBe(false)
            expect(isIdempotencyMarkerExpired(row as { createdAt?: unknown }, nowMs)).toBe(false)
          } else if (row.kind === 'audit') {
            expect(isFloorChangeAuditExpired({ changedAt: row.changedAt }, nowMs)).toBe(expected)
            expect(isBoosterPurchaseExpired(row as { paidAt?: unknown }, nowMs)).toBe(false)
            expect(isIdempotencyMarkerExpired(row as { createdAt?: unknown }, nowMs)).toBe(false)
          } else {
            expect(isIdempotencyMarkerExpired({ createdAt: row.createdAt }, nowMs)).toBe(expected)
            expect(isBoosterPurchaseExpired(row as { paidAt?: unknown }, nowMs)).toBe(false)
            expect(isFloorChangeAuditExpired(row as { changedAt?: unknown }, nowMs)).toBe(false)
          }
        }
      }),
      { numRuns: 100 },
    )
  })
})
