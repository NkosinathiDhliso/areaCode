/**
 * Property 11: Boost ROI Computation
 *
 * For any boost window with check-in count C and historical data of at least 2 weeks,
 * the baseline SHALL equal the arithmetic mean of check-in counts for the same time
 * window across the prior 4 available weeks, and uplift SHALL equal
 * `((C - baseline) / baseline) * 100`. If fewer than 2 weeks of data exist, the system
 * SHALL return an "insufficient data" indicator instead of a numeric uplift.
 *
 * **Validates: Requirements 8.2, 8.3, 8.4**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computeBaseline, computeUplift } from '../../features/business/boost-roi-computation'

describe('Property 11: Boost ROI Computation', () => {
  it('baseline equals arithmetic mean of historical counts when >= 2 weeks of data', async () => {
    await fc.assert(
      fc.property(
        // Historical counts: 2-4 weeks of data, each week 0-500 check-ins
        fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 2, maxLength: 4 }),
        (historicalCounts) => {
          const baseline = computeBaseline(historicalCounts)
          const expectedMean = historicalCounts.reduce((a, b) => a + b, 0) / historicalCounts.length
          expect(baseline).not.toBeNull()
          expect(baseline).toBeCloseTo(expectedMean, 10)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('returns null (insufficient data) when fewer than 2 weeks of data', async () => {
    await fc.assert(
      fc.property(
        // 0 or 1 weeks of data
        fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 0, maxLength: 1 }),
        (historicalCounts) => {
          const baseline = computeBaseline(historicalCounts)
          expect(baseline).toBeNull()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('uplift equals ((C - baseline) / baseline) * 100 when baseline is valid and non-zero', async () => {
    await fc.assert(
      fc.property(
        // Boost check-ins
        fc.integer({ min: 0, max: 1000 }),
        // Baseline (non-zero positive)
        fc.double({ min: 0.1, max: 500, noNaN: true }),
        (boostCheckIns, baseline) => {
          const uplift = computeUplift(boostCheckIns, baseline)
          const expected = ((boostCheckIns - baseline) / baseline) * 100
          expect(uplift).not.toBeNull()
          expect(uplift).toBeCloseTo(expected, 5)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('uplift is null when baseline is null (insufficient data)', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        (boostCheckIns) => {
          const uplift = computeUplift(boostCheckIns, null)
          expect(uplift).toBeNull()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('uplift is null when baseline is zero (division by zero protection)', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        (boostCheckIns) => {
          const uplift = computeUplift(boostCheckIns, 0)
          expect(uplift).toBeNull()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('uplift is positive when boost check-ins exceed baseline', async () => {
    await fc.assert(
      fc.property(
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: 0.01, max: 500, noNaN: true }),
        (extra, baseline) => {
          const boostCheckIns = Math.ceil(baseline + extra)
          const uplift = computeUplift(boostCheckIns, baseline)
          expect(uplift).not.toBeNull()
          expect(uplift!).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('uplift is negative when boost check-ins are below baseline', async () => {
    await fc.assert(
      fc.property(
        // Baseline must be > 1 so we can have boostCheckIns < baseline
        fc.double({ min: 2, max: 500, noNaN: true }),
        (baseline) => {
          const boostCheckIns = Math.floor(baseline / 2)
          const uplift = computeUplift(boostCheckIns, baseline)
          expect(uplift).not.toBeNull()
          expect(uplift!).toBeLessThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })
})
