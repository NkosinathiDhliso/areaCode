import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { isClaimEligible, type GetCategory, type Lifecycle } from '../lifecycle.js'

/**
 * Event & Offer Gets — claim-eligibility truth-table property test.
 *
 * Property 3: over the full cross product of
 * (getCategory, claimRequiresCheckIn, lifecycle, hasQualifyingCheckIn),
 * isClaimEligible matches the R4/R8.4 table exactly. Loyalty is always eligible
 * at this gate.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 8.4**
 */

const CATEGORIES: GetCategory[] = ['loyalty', 'event', 'offer']
const LIFECYCLES: Lifecycle[] = ['upcoming', 'live', 'ended']
const BOOLS = [true, false]

/**
 * Reference implementation of the R4/R8.4 truth table, written independently of
 * the production code so the property compares two derivations of the same rule.
 */
function expected(
  getCategory: GetCategory,
  claimRequiresCheckIn: boolean,
  lifecycle: Lifecycle,
  hasQualifyingCheckIn: boolean,
): { eligible: true } | { eligible: false; code: 'check_in_required' | 'not_live' } {
  // Loyalty is always eligible at this gate (R4 — existing rules apply elsewhere).
  if (getCategory === 'loyalty') return { eligible: true }

  // Event/offer must be live to be claimable (R8.4).
  if (lifecycle !== 'live') return { eligible: false, code: 'not_live' }

  // Live event/offer requiring a check-in without one is blocked (R4.2).
  if (claimRequiresCheckIn && !hasQualifyingCheckIn) {
    return { eligible: false, code: 'check_in_required' }
  }

  // Live event/offer that either does not require a check-in or has one (R4.1, R4.3).
  return { eligible: true }
}

describe('Feature: event-and-offer-gets, Property 3: Claim eligibility truth table', () => {
  const inputArb = fc.record({
    getCategory: fc.constantFrom(...CATEGORIES),
    claimRequiresCheckIn: fc.constantFrom(...BOOLS),
    lifecycle: fc.constantFrom(...LIFECYCLES),
    hasQualifyingCheckIn: fc.constantFrom(...BOOLS),
  })

  it('matches the R4/R8.4 reference table over arbitrary inputs', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = isClaimEligible(input)
        const ref = expected(input.getCategory, input.claimRequiresCheckIn, input.lifecycle, input.hasQualifyingCheckIn)
        expect(result).toEqual(ref)
      }),
    )
  })

  it('matches the reference table over the full exhaustive cross product', () => {
    for (const getCategory of CATEGORIES) {
      for (const claimRequiresCheckIn of BOOLS) {
        for (const lifecycle of LIFECYCLES) {
          for (const hasQualifyingCheckIn of BOOLS) {
            const input = {
              getCategory,
              claimRequiresCheckIn,
              lifecycle,
              hasQualifyingCheckIn,
            }
            expect(isClaimEligible(input)).toEqual(
              expected(getCategory, claimRequiresCheckIn, lifecycle, hasQualifyingCheckIn),
            )
          }
        }
      }
    }
  })

  it('keeps loyalty eligible regardless of lifecycle or check-in state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LIFECYCLES),
        fc.constantFrom(...BOOLS),
        fc.constantFrom(...BOOLS),
        (lifecycle, claimRequiresCheckIn, hasQualifyingCheckIn) => {
          expect(
            isClaimEligible({
              getCategory: 'loyalty',
              claimRequiresCheckIn,
              lifecycle,
              hasQualifyingCheckIn,
            }),
          ).toEqual({ eligible: true })
        },
      ),
    )
  })
})
