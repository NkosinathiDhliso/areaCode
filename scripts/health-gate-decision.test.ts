import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { evaluateHealthGate, HealthDecision } from './health-gate-decision.mjs'

// Feature: release-quality-and-ops-hygiene, Property 2: the Health_Gate decision
// rule votes ROLLBACK iff a well-fed frontend monitor regressed beyond threshold
// OR a backend alarm is firing, and always returns the distinct MISSING_DATA
// outcome on missing data.
//
// **Validates: Requirements 2.1, 2.4**
//
// The test rebuilds the rule as an independent oracle from the same inputs and
// asserts the module agrees with it across the input space. Generators are split
// so that "well-fed, finite" signals and "missing-data" signals are each explored
// densely rather than colliding by chance.

const THRESHOLD = 0.05
const MIN_SESSIONS = 30

const ALARM_STATES = ['OK', 'ALARM', 'INSUFFICIENT_DATA'] as const

// A frontend signal with finite, non-negative, positive-session metrics: the
// only shape that can ever cast (or withhold) a regression vote without being
// classified as missing data.
const finiteSignalArb = fc.record({
  monitor: fc.constantFrom('web', 'business', 'staff', 'admin'),
  windowErrorRate: fc.double({ min: 0, max: 1, noNaN: true }),
  baselineErrorRate: fc.double({ min: 0, max: 1, noNaN: true }),
  // >= 1 so the total-session floor is always cleared by the array as a whole.
  windowSessions: fc.integer({ min: 1, max: 5000 }),
})

const alarmArb = fc.record({
  name: fc.string(),
  state: fc.constantFrom(...ALARM_STATES),
})

// Oracle for the healthy-path decision (inputs already known to be well-formed
// and non-empty). Mirrors the rule without reusing the implementation.
function expectedDecisionForValidInput(
  frontendSignals: Array<{
    monitor: string
    windowErrorRate: number
    baselineErrorRate: number
    windowSessions: number
  }>,
  backendAlarms: Array<{ name: string; state: string }>,
): string {
  const backendVotes = backendAlarms.some((a) => a.state === 'ALARM')
  const frontendVotes = frontendSignals.some(
    (s) => s.windowSessions >= MIN_SESSIONS && s.windowErrorRate - s.baselineErrorRate > THRESHOLD,
  )
  return backendVotes || frontendVotes ? HealthDecision.ROLLBACK : HealthDecision.NO_ROLLBACK
}

describe('Feature: release-quality-and-ops-hygiene, Property 2: health-gate decision rule', () => {
  it('votes ROLLBACK iff a well-fed monitor regressed beyond threshold OR an alarm fires', () => {
    fc.assert(
      fc.property(
        fc.array(finiteSignalArb, { minLength: 1, maxLength: 6 }),
        fc.array(alarmArb, { maxLength: 6 }),
        (frontendSignals, backendAlarms) => {
          const result = evaluateHealthGate({ frontendSignals, backendAlarms })
          const expected = expectedDecisionForValidInput(frontendSignals, backendAlarms)
          expect(result.decision).toBe(expected)
          expect(Array.isArray(result.reasons)).toBe(true)
          expect(result.reasons.length).toBeGreaterThan(0)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('always returns the distinct MISSING_DATA outcome on missing data', () => {
    // Each generated case forces exactly one missing-data condition, so the
    // rule must classify it as MISSING_DATA regardless of the other signals.
    const missingDataCaseArb = fc.oneof(
      // 1. Explicit collection failure flag.
      fc.record({
        hasMissingData: fc.constant(true),
        frontendSignals: fc.array(finiteSignalArb, { maxLength: 4 }),
        backendAlarms: fc.array(alarmArb, { maxLength: 4 }),
      }),
      // 2. Structurally absent / empty frontend signals.
      fc.record({
        frontendSignals: fc.constantFrom([], undefined, null),
        backendAlarms: fc.array(alarmArb, { maxLength: 4 }),
      }),
      // 3. Backend signal array absent.
      fc.record({
        frontendSignals: fc.array(finiteSignalArb, { minLength: 1, maxLength: 4 }),
        backendAlarms: fc.constantFrom(undefined, null),
      }),
      // 4. A non-finite / negative metric value on some monitor.
      fc.record({
        frontendSignals: fc.array(finiteSignalArb, { minLength: 1, maxLength: 4 }).chain((signals) =>
          fc
            .record({
              index: fc.nat({ max: Math.max(0, signals.length - 1) }),
              bad: fc.constantFrom(
                { windowErrorRate: Number.NaN },
                { baselineErrorRate: Number.POSITIVE_INFINITY },
                { windowSessions: Number.NaN },
                { windowSessions: -1 },
              ),
            })
            .map(({ index, bad }) => signals.map((s, i) => (i === index ? { ...s, ...bad } : s))),
        ),
        backendAlarms: fc.array(alarmArb, { maxLength: 4 }),
      }),
      // 5. Empty metric set: every monitor reports zero sessions.
      fc.record({
        frontendSignals: fc.array(
          fc.record({
            monitor: fc.constantFrom('web', 'business', 'staff', 'admin'),
            windowErrorRate: fc.double({ min: 0, max: 1, noNaN: true }),
            baselineErrorRate: fc.double({ min: 0, max: 1, noNaN: true }),
            windowSessions: fc.constant(0),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        backendAlarms: fc.array(alarmArb, { maxLength: 4 }),
      }),
    )

    fc.assert(
      fc.property(missingDataCaseArb, (input) => {
        const result = evaluateHealthGate(input as Parameters<typeof evaluateHealthGate>[0])
        expect(result.decision).toBe(HealthDecision.MISSING_DATA)
        expect(result.reasons.length).toBeGreaterThan(0)
      }),
      { numRuns: 300 },
    )
  })
})
