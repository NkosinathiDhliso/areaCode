import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
  deriveMomentum,
  pruneSamples,
  MOMENTUM_WINDOW_SECONDS,
  MOMENTUM_MIN_SPAN_SECONDS,
  MOMENTUM_MIN_DELTA,
  type PresenceSample,
} from './momentum.js'

const NOW = 1_000_000

describe('deriveMomentum', () => {
  it('rising past the delta over a sufficient span reads as filling_up', () => {
    const samples: PresenceSample[] = [
      { t: NOW - 600, count: 2 },
      { t: NOW, count: 6 },
    ]
    expect(deriveMomentum(samples, NOW)).toBe('filling_up')
  })

  it('falling past the delta over a sufficient span reads as winding_down', () => {
    const samples: PresenceSample[] = [
      { t: NOW - 600, count: 9 },
      { t: NOW, count: 3 },
    ]
    expect(deriveMomentum(samples, NOW)).toBe('winding_down')
  })

  it('is steady with fewer than two in-window samples', () => {
    expect(deriveMomentum([{ t: NOW, count: 5 }], NOW)).toBe('steady')
    expect(deriveMomentum([], NOW)).toBe('steady')
  })

  it('is steady when the span is too short to be a real trend', () => {
    const samples: PresenceSample[] = [
      { t: NOW - 10, count: 1 },
      { t: NOW, count: 20 },
    ]
    expect(deriveMomentum(samples, NOW)).toBe('steady')
  })

  it('ignores samples older than the trailing window', () => {
    const samples: PresenceSample[] = [
      { t: NOW - (MOMENTUM_WINDOW_SECONDS + 100), count: 0 },
      { t: NOW, count: 50 },
    ]
    // Only the recent sample is in window → not enough to claim a trend.
    expect(deriveMomentum(samples, NOW)).toBe('steady')
  })
})

// A generator for a well-ordered in-window series with a controllable start/end.
const inWindowSamples = fc
  .array(
    fc.record({
      offset: fc.integer({ min: 0, max: MOMENTUM_WINDOW_SECONDS }),
      count: fc.integer({ min: 0, max: 200 }),
    }),
    { minLength: 2, maxLength: 30 },
  )
  .map((rows) => rows.map((r) => ({ t: NOW - r.offset, count: r.count })))

describe('deriveMomentum properties', () => {
  // Feature: momentum, Property 1: the result is always one of the three labels.
  it('Property 1: always returns a valid momentum label', () => {
    fc.assert(
      fc.property(inWindowSamples, (samples) => {
        const result = deriveMomentum(samples, NOW)
        expect(['filling_up', 'winding_down', 'steady']).toContain(result)
      }),
      { numRuns: 200 },
    )
  })

  // Feature: momentum, Property 2: a genuine, well-spaced rise reads filling_up.
  it('Property 2: a rise of >= MIN_DELTA over >= MIN_SPAN is filling_up', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: MOMENTUM_MIN_DELTA, max: 100 }),
        fc.integer({ min: MOMENTUM_MIN_SPAN_SECONDS, max: MOMENTUM_WINDOW_SECONDS }),
        (baseCount, rise, span) => {
          const samples: PresenceSample[] = [
            { t: NOW - span, count: baseCount },
            { t: NOW, count: baseCount + rise },
          ]
          expect(deriveMomentum(samples, NOW)).toBe('filling_up')
        },
      ),
      { numRuns: 200 },
    )
  })

  // Feature: momentum, Property 3: a genuine, well-spaced fall reads winding_down
  // (only possible because real departures decremented the count).
  it('Property 3: a fall of >= MIN_DELTA over >= MIN_SPAN is winding_down', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MOMENTUM_MIN_DELTA, max: 200 }),
        fc.integer({ min: MOMENTUM_MIN_DELTA, max: 100 }),
        fc.integer({ min: MOMENTUM_MIN_SPAN_SECONDS, max: MOMENTUM_WINDOW_SECONDS }),
        (baseCount, fall, span) => {
          const start = baseCount + fall
          const samples: PresenceSample[] = [
            { t: NOW - span, count: start },
            { t: NOW, count: start - fall },
          ]
          expect(deriveMomentum(samples, NOW)).toBe('winding_down')
        },
      ),
      { numRuns: 200 },
    )
  })

  // Feature: momentum, Property 4: pruning never keeps an out-of-window sample.
  it('Property 4: pruneSamples keeps only samples within [now - W, now], sorted', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            t: fc.integer({ min: NOW - 3 * MOMENTUM_WINDOW_SECONDS, max: NOW + MOMENTUM_WINDOW_SECONDS }),
            count: fc.integer({ min: 0, max: 200 }),
          }),
          { maxLength: 40 },
        ),
        (samples) => {
          const pruned = pruneSamples(samples, NOW)
          for (const s of pruned) {
            expect(s.t).toBeGreaterThanOrEqual(NOW - MOMENTUM_WINDOW_SECONDS)
            expect(s.t).toBeLessThanOrEqual(NOW)
          }
          for (let i = 1; i < pruned.length; i++) {
            expect(pruned[i]!.t).toBeGreaterThanOrEqual(pruned[i - 1]!.t)
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
