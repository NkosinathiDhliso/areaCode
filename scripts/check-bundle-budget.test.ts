import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { sumInitialChunkBytes, isWithinBudget } from './check-bundle-budget.mjs'

// Feature: release-quality-and-ops-hygiene, Property 1: for arbitrary sets of
// chunk descriptors the budget script sums EXACTLY the initial chunks (those
// flagged `initial === true`, contributing their `size`), passes iff the sum is
// within budget (monotone pass/fail), and never throws on empty or malformed
// input.
//
// **Validates: Requirements 9.3**
//
// The test rebuilds the summing rule as an independent oracle and asserts the
// module agrees with it across the input space. Generators are split so the
// clean "well-formed descriptor" space and the hostile "malformed input" space
// are each explored densely.

// A well-formed descriptor: finite, non-negative size and an explicit initial
// flag. This is the only shape the oracle reasons about exactly.
const cleanDescriptorArb = fc.record({
  name: fc.string(),
  size: fc.nat({ max: 5_000_000 }),
  initial: fc.boolean(),
})

// Independent oracle: sum the sizes of exactly the descriptors flagged initial.
function expectedInitialSum(descriptors: Array<{ size: number; initial: boolean }>): number {
  return descriptors.filter((d) => d.initial === true).reduce((total, d) => total + d.size, 0)
}

describe('Feature: release-quality-and-ops-hygiene, Property 1: bundle budget script', () => {
  it('sums exactly the initial chunks and ignores non-initial ones', () => {
    fc.assert(
      fc.property(fc.array(cleanDescriptorArb, { maxLength: 40 }), (descriptors) => {
        const total = sumInitialChunkBytes(descriptors)
        expect(total).toBe(expectedInitialSum(descriptors))
      }),
      { numRuns: 200 },
    )
  })

  it('flipping a descriptor to non-initial removes exactly its size from the total', () => {
    fc.assert(
      fc.property(fc.array(cleanDescriptorArb, { minLength: 1, maxLength: 40 }), (descriptors) => {
        // Force one descriptor initial, then flip it off: the total drops by
        // exactly that descriptor's size, proving non-initial chunks are
        // ignored.
        const idx = 0
        const withInitial = descriptors.map((d, i) => (i === idx ? { ...d, initial: true } : d))
        const withoutInitial = withInitial.map((d, i) => (i === idx ? { ...d, initial: false } : d))
        const totalWith = sumInitialChunkBytes(withInitial)
        const totalWithout = sumInitialChunkBytes(withoutInitial)
        expect(totalWith - totalWithout).toBe(withInitial[idx].size)
      }),
      { numRuns: 200 },
    )
  })

  it('yields total 0 and never throws on empty or non-array input', () => {
    const emptyOrNonArrayArb = fc.oneof(
      fc.constant([]),
      fc.constant(undefined),
      fc.constant(null),
      fc.constant({}),
      fc.string(),
      fc.integer(),
      fc.boolean(),
    )
    fc.assert(
      fc.property(emptyOrNonArrayArb, (input) => {
        const total = sumInitialChunkBytes(input as never)
        expect(total).toBe(0)
      }),
      { numRuns: 200 },
    )
  })

  it('never throws and stays non-negative on arbitrary malformed descriptor arrays', () => {
    // Descriptors may carry junk sizes (NaN, negative, strings, missing) and
    // junk flags. The function must be total: never throw, never go negative.
    const junkDescriptorArb = fc.oneof(
      fc.record({
        name: fc.option(fc.string(), { nil: undefined }),
        size: fc.oneof(
          fc.integer(),
          fc.double(),
          fc.string(),
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(Number.NaN),
        ),
        initial: fc.oneof(fc.boolean(), fc.constant(undefined), fc.constant(1), fc.string()),
      }),
      fc.anything(),
    )
    fc.assert(
      fc.property(fc.array(junkDescriptorArb, { maxLength: 40 }), (descriptors) => {
        const total = sumInitialChunkBytes(descriptors as never)
        expect(Number.isFinite(total)).toBe(true)
        expect(total).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 200 },
    )
  })

  it('is monotone in budget: a total within budget B stays within any budget >= B', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000_000 }),
        fc.nat({ max: 10_000_000 }),
        fc.nat({ max: 10_000_000 }),
        (total, budgetA, delta) => {
          const higherBudget = budgetA + delta
          if (isWithinBudget(total, budgetA)) {
            expect(isWithinBudget(total, higherBudget)).toBe(true)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('is monotone in total: adding an initial chunk never turns a fail into a pass', () => {
    fc.assert(
      fc.property(
        fc.array(cleanDescriptorArb, { maxLength: 40 }),
        cleanDescriptorArb,
        fc.nat({ max: 10_000_000 }),
        (descriptors, extra, budget) => {
          const before = sumInitialChunkBytes(descriptors)
          // An additional INITIAL chunk can only add bytes.
          const initialExtra = { ...extra, initial: true }
          const after = sumInitialChunkBytes([...descriptors, initialExtra])
          expect(after).toBeGreaterThanOrEqual(before)
          // Monotone pass/fail: if it failed before, more initial bytes cannot
          // make it pass.
          if (!isWithinBudget(before, budget)) {
            expect(isWithinBudget(after, budget)).toBe(false)
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
