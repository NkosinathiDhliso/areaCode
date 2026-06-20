/**
 * Property 5: Floor input-validation accept count.
 *
 * For any sequence of admin floor-update requests with `floorCents` values
 * drawn from a distribution mixing in-range integers (`[1, 1_000_000]`) with
 * out-of-range values (negatives, zero, fractional, > 1_000_000, NaN) and a
 * mix of valid / invalid `duration` values:
 *
 *   - the count of accepted updates equals the count of in-range integer
 *     `floorCents` requests with a valid `duration`,
 *   - the count of rejected updates equals the rest, AND
 *   - no `BoostFloor_Row` (pk='BOOST_FLOOR') or `Floor_Change_Audit_Row`
 *     (pk starts with 'BOOST_FLOOR_AUDIT#') is written for any rejected
 *     request.
 *
 * Validates: Requirements 4.3, 4.6, 10.6
 *
 * Strategy:
 *   The repository goes through the AWS SDK `documentClient`, which we mock
 *   so all `PutCommand` / `GetCommand` calls land on an in-memory test
 *   double. We track every `PutCommand` and per-request assert that no
 *   `BoostFloor_Row` or `Floor_Change_Audit_Row` was written for a reject.
 *   `changeReason` is held to `null` per the task brief so the test
 *   exercises only `floorCents` / `duration` validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// `vi.hoisted` runs before the `vi.mock` factories so the spy reference
// inside the factory is defined when the mock is installed.

const mocks = vi.hoisted(() => {
  const sendMock = vi.fn(async (cmd: unknown) => {
    const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}
    // GetCommand on the previous floor — return "no row" so updateBoostFloor
    // takes the `previousFloorCents = null` branch (still writes both rows).
    if ('Key' in input) {
      return {}
    }
    // PutCommand — accept all writes.
    if ('Item' in input) {
      return {}
    }
    return {}
  })
  return { sendMock }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: {
    appData: 'app-data',
    users: 'users',
    nodes: 'nodes',
    checkins: 'checkins',
    rewards: 'rewards',
    businesses: 'businesses',
    musicSchedules: 'music-schedules',
  },
}))

// Import AFTER the mock so the module-level `documentClient` import in
// repository.ts picks up the stub.
import { updateBoostFloor } from '../service.js'
import { AppError } from '../../../shared/errors/AppError.js'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const VALID_DURATIONS = ['2hr', '6hr', '24hr'] as const

/**
 * `duration` arbitrary: weighted between the three valid values and a grab
 * bag of invalid strings. All values are typed as `unknown` because the
 * service layer is supposed to reject anything outside the union, and we
 * pass them through `as never` at the call site.
 */
const durationArb: fc.Arbitrary<unknown> = fc.oneof(
  // 75% of the time: a valid duration.
  { weight: 3, arbitrary: fc.constantFrom(...VALID_DURATIONS) },
  // 25% of the time: an arbitrary string that is unlikely to collide with
  // the valid set. `filter` guards against the rare collision.
  {
    weight: 1,
    arbitrary: fc
      .string({ minLength: 0, maxLength: 32 })
      .filter((s) => !VALID_DURATIONS.includes(s as (typeof VALID_DURATIONS)[number])),
  },
)

/** In-range integer `floorCents`: [1, 1_000_000]. */
const validFloorCentsArb = fc.integer({ min: 1, max: 1_000_000 })

/**
 * Out-of-range `floorCents`: a mix of negatives, zero, fractional (non-
 * integer) values, integers strictly greater than 1_000_000, and `NaN`.
 */
const invalidFloorCentsArb: fc.Arbitrary<number> = fc.oneof(
  // Zero is below the minimum (R4.3 requires >= 1).
  { weight: 1, arbitrary: fc.constant(0) },
  // Negative integers.
  { weight: 1, arbitrary: fc.integer({ min: -1_000_000, max: -1 }) },
  // Integers strictly greater than the max.
  { weight: 1, arbitrary: fc.integer({ min: 1_000_001, max: 10_000_000 }) },
  // Fractional values inside the range — non-integer, so rejected.
  {
    weight: 1,
    arbitrary: fc
      .double({ min: 0.0001, max: 1_000_000, noNaN: true })
      .filter((n) => !Number.isInteger(n) && Number.isFinite(n)),
  },
  // NaN — non-integer, rejected.
  { weight: 1, arbitrary: fc.constant(Number.NaN) },
)

/**
 * `floorCents` arbitrary: 60% valid, 40% invalid. The mix-rate is chosen so
 * a sequence of length ~25 reliably contains both classes.
 */
const floorCentsArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: validFloorCentsArb },
  { weight: 2, arbitrary: invalidFloorCentsArb },
)

const adminArb = fc.record({
  sub: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
  email: fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0),
      fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0),
    )
    .map(([local, domain]) => `${local}@${domain}.test`)
    .filter((e) => e.length >= 3 && e.length <= 254),
})

const requestArb = fc.record({
  duration: durationArb,
  floorCents: floorCentsArb,
  admin: adminArb,
})

const sequenceArb = fc.array(requestArb, { minLength: 1, maxLength: 50 })

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidRequest(req: { duration: unknown; floorCents: number }): boolean {
  const validDuration =
    typeof req.duration === 'string' && VALID_DURATIONS.includes(req.duration as (typeof VALID_DURATIONS)[number])
  const validFloor =
    typeof req.floorCents === 'number' &&
    Number.isInteger(req.floorCents) &&
    req.floorCents >= 1 &&
    req.floorCents <= 1_000_000
  return validDuration && validFloor
}

interface CapturedPut {
  pk: unknown
  sk: unknown
}

function isFloorRowWrite(item: CapturedPut): boolean {
  return item.pk === 'BOOST_FLOOR'
}

function isFloorAuditRowWrite(item: CapturedPut): boolean {
  return typeof item.pk === 'string' && item.pk.startsWith('BOOST_FLOOR_AUDIT#')
}

beforeEach(() => {
  mocks.sendMock.mockClear()
})

// ─── Property 5 ─────────────────────────────────────────────────────────────

describe('Property 5: floor input-validation accept count', () => {
  it('accepted/rejected counts match input classification AND no floor or audit row is written for any rejected request', async () => {
    await fc.assert(
      fc.asyncProperty(sequenceArb, async (sequence) => {
        // Reset the spy at the start of each sequence so accumulated calls
        // from earlier shrinks do not leak into the assertions.
        mocks.sendMock.mockClear()

        let acceptedCount = 0
        let rejectedCount = 0
        let expectedAccepted = 0
        let expectedRejected = 0

        for (const req of sequence) {
          const expectedAccept = isValidRequest(req)
          if (expectedAccept) expectedAccepted++
          else expectedRejected++

          // Snapshot current call count so we can scope per-request writes.
          const callsBefore = mocks.sendMock.mock.calls.length

          let outcome: 'accept' | 'reject'
          let thrown: unknown = null
          try {
            await updateBoostFloor(
              // The service signature types `duration` as `BoostDuration`;
              // we deliberately pass arbitrary values through `as never` so
              // the service-layer validation is exercised.
              req.duration as never,
              req.floorCents,
              null,
              req.admin,
            )
            outcome = 'accept'
          } catch (err) {
            outcome = 'reject'
            thrown = err
          }

          // Per-request writes captured during this single call.
          const perRequestPuts: CapturedPut[] = []
          for (let i = callsBefore; i < mocks.sendMock.mock.calls.length; i++) {
            const cmd = mocks.sendMock.mock.calls[i]?.[0] as { input?: { Item?: Record<string, unknown> } } | undefined
            const item = cmd?.input?.Item
            if (item && 'pk' in item) {
              perRequestPuts.push({ pk: item['pk'], sk: item['sk'] })
            }
          }

          if (expectedAccept) {
            expect(outcome).toBe('accept')
            acceptedCount++
            // An accepted request MUST persist exactly one Floor_Change_Audit_Row
            // and exactly one BoostFloor_Row (audit-first, R5.2).
            expect(perRequestPuts.filter(isFloorAuditRowWrite)).toHaveLength(1)
            expect(perRequestPuts.filter(isFloorRowWrite)).toHaveLength(1)
          } else {
            expect(outcome).toBe('reject')
            rejectedCount++
            // The thrown error must be an AppError with status 400 (R4.3, R4.6).
            expect(thrown).toBeInstanceOf(AppError)
            expect((thrown as AppError).statusCode).toBe(400)
            // Critical invariant: a rejected request MUST NOT write any
            // BoostFloor_Row or Floor_Change_Audit_Row.
            expect(perRequestPuts.filter(isFloorRowWrite)).toHaveLength(0)
            expect(perRequestPuts.filter(isFloorAuditRowWrite)).toHaveLength(0)
          }
        }

        expect(acceptedCount).toBe(expectedAccepted)
        expect(rejectedCount).toBe(expectedRejected)
      }),
      { numRuns: 25 },
    )
  })
})
