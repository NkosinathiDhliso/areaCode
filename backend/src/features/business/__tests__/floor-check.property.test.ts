import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { checkBoostFloor } from '../service.js'
import { decideBoostFloorWithMetric, type BoostMetricInput, type PutMetricFn } from '../floor-decision.js'
import type { BoostDuration } from '../types.js'

/**
 * Property 1: Floor decision is exact and rejection emits metric.
 *
 * For any (duration ∈ {'2hr','6hr','24hr'}, computedPriceCents ∈ [0, 10_000_000],
 * floorCents ∈ [1, 1_000_000]) triple:
 *
 *   - `checkBoostFloor` returns `accept` iff `computedPriceCents >= floorCents`.
 *   - `decideBoostFloorWithMetric` issues a `BoostFloorViolation` `PutMetricData`
 *     call exactly once iff the decision is `reject`, and zero times iff `accept`.
 *   - `decideBoostFloorWithMetric` still returns the reject decision even when
 *     the metric-emission callback throws (R9.5).
 *
 * Validates: Requirements 3.3, 3.4, 9.5, 10.1
 */

const durationArb: fc.Arbitrary<BoostDuration> = fc.constantFrom('2hr', '6hr', '24hr')
const computedPriceCentsArb = fc.integer({ min: 0, max: 10_000_000 })
const floorCentsArb = fc.integer({ min: 1, max: 1_000_000 })
const businessIdArb = fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0)

describe('Property 1: floor decision is exact and rejection emits metric', () => {
  it('checkBoostFloor returns accept iff computedPriceCents >= floorCents', () => {
    fc.assert(
      fc.property(computedPriceCentsArb, floorCentsArb, (computedPriceCents, floorCents) => {
        const result = checkBoostFloor(computedPriceCents, floorCents)
        const expectedAccept = computedPriceCents >= floorCents

        if (expectedAccept) {
          expect(result).toEqual({ decision: 'accept' })
        } else {
          expect(result).toEqual({ decision: 'reject', code: 'BOOST_BELOW_FLOOR' })
        }
      }),
      { numRuns: 25 },
    )
  })

  it('decideBoostFloorWithMetric emits BoostFloorViolation exactly once iff decision is reject', async () => {
    await fc.assert(
      fc.asyncProperty(
        durationArb,
        computedPriceCentsArb,
        floorCentsArb,
        businessIdArb,
        async (duration, computedPriceCents, floorCents, businessId) => {
          const calls: BoostMetricInput[] = []
          const putMetric: PutMetricFn = (input) => {
            calls.push(input)
          }

          const result = await decideBoostFloorWithMetric(
            computedPriceCents,
            floorCents,
            duration,
            businessId,
            putMetric,
          )

          const shouldReject = computedPriceCents < floorCents

          if (shouldReject) {
            expect(result).toEqual({ decision: 'reject', code: 'BOOST_BELOW_FLOOR' })
            expect(calls).toHaveLength(1)
            const [call] = calls
            expect(call?.MetricName).toBe('BoostFloorViolation')
            // Dimensions must include both duration and businessId, in that order.
            expect(call?.Dimensions).toEqual([
              { Name: 'duration', Value: duration },
              { Name: 'businessId', Value: businessId },
            ])
          } else {
            expect(result).toEqual({ decision: 'accept' })
            expect(calls).toHaveLength(0)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('decideBoostFloorWithMetric still rejects when the metric emission throws', async () => {
    // Constrain to the reject case: computedPriceCents < floorCents.
    const rejectCaseArb = fc.tuple(computedPriceCentsArb, floorCentsArb).filter(([price, floor]) => price < floor)

    await fc.assert(
      fc.asyncProperty(
        durationArb,
        rejectCaseArb,
        businessIdArb,
        async (duration, [computedPriceCents, floorCents], businessId) => {
          const throwingPutMetric: PutMetricFn = () => {
            throw new Error('CloudWatch unavailable')
          }

          const result = await decideBoostFloorWithMetric(
            computedPriceCents,
            floorCents,
            duration,
            businessId,
            throwingPutMetric,
          )

          // Rejection MUST NOT be conditional on metric emission succeeding (R9.5).
          expect(result).toEqual({ decision: 'reject', code: 'BOOST_BELOW_FLOOR' })
        },
      ),
      { numRuns: 25 },
    )
  })
})
