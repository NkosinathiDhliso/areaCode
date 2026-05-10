/**
 * Property 9: Exponential Backoff Calculation
 *
 * For any retry attempt number N (0-indexed), the reconnection delay SHALL equal
 * `min(1000 * 2^N + jitter, 30000)` where jitter is a random value in [0, 1000).
 * The delay SHALL never exceed 30 seconds and SHALL always be >= 1 second.
 *
 * **Validates: Requirements 12.1**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calculateBackoffDelay } from '@area-code/shared/lib/websocket'

describe('Property 9: Exponential Backoff Calculation', () => {
  it('delay equals min(1000 * 2^N + jitter, 30000) for any attempt N and jitter in [0, 1000)', async () => {
    await fc.assert(
      fc.property(
        // Retry attempt N (0-indexed), testing up to 20 attempts
        fc.integer({ min: 0, max: 20 }),
        // Jitter value in [0, 1000)
        fc.double({ min: 0, max: 999.999, noNaN: true }),
        (attempt, jitter) => {
          const result = calculateBackoffDelay(attempt, jitter)
          const expected = Math.min(1000 * Math.pow(2, attempt) + jitter, 30000)
          expect(result).toBeCloseTo(expected, 5)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('delay never exceeds 30 seconds for any attempt number', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.double({ min: 0, max: 999.999, noNaN: true }),
        (attempt, jitter) => {
          const result = calculateBackoffDelay(attempt, jitter)
          expect(result).toBeLessThanOrEqual(30000)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('delay is always >= 1 second (1000ms) for any attempt', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.double({ min: 0, max: 999.999, noNaN: true }),
        (attempt, jitter) => {
          const result = calculateBackoffDelay(attempt, jitter)
          // At attempt 0 with jitter 0: 1000 * 2^0 + 0 = 1000ms
          expect(result).toBeGreaterThanOrEqual(1000)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('delay increases monotonically with attempt number (for same jitter)', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 19 }),
        fc.double({ min: 0, max: 999.999, noNaN: true }),
        (attempt, jitter) => {
          const current = calculateBackoffDelay(attempt, jitter)
          const next = calculateBackoffDelay(attempt + 1, jitter)
          // Next delay should be >= current (both capped at 30000)
          expect(next).toBeGreaterThanOrEqual(current)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('caps at 30000ms for high attempt numbers regardless of jitter', async () => {
    await fc.assert(
      fc.property(
        // High attempt numbers where 1000 * 2^N > 30000 (N >= 5 means base > 32000)
        fc.integer({ min: 5, max: 50 }),
        fc.double({ min: 0, max: 999.999, noNaN: true }),
        (attempt, jitter) => {
          const result = calculateBackoffDelay(attempt, jitter)
          expect(result).toBe(30000)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('without explicit jitter, delay is still within bounds', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        (attempt) => {
          const result = calculateBackoffDelay(attempt)
          expect(result).toBeGreaterThanOrEqual(1000)
          expect(result).toBeLessThanOrEqual(30000)
        },
      ),
      { numRuns: 100 },
    )
  })
})
