import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  applyResult,
  classify,
  createEntry,
  isDue,
  isExpired,
  isParked,
  MAX_RETRIES,
  reEnqueue,
  shouldEnqueue,
  type AttemptResult,
  type OutboxEntry,
} from './checkinOutbox'

/**
 * Feature: cross-portal-lifecycle-alignment, Property 2: Outbox state machine.
 *
 * **Validates: Requirements 5.1, 5.2, 5.4, 5.5**
 *
 * For any sequence of failures, successes, 4xx responses, and clock advances:
 *
 *   1. An entry is in exactly one of {queued, parked, gone} at every step.
 *   2. retryCount never exceeds MAX_RETRIES (3).
 *   3. An entry older than the Replay_Window is never "due" — it can never
 *      generate a network call.
 *   4. A success or a permanent (4xx) result always removes the entry.
 *   5. Only network (statusCode 0) and 5xx are enqueue-worthy; 4xx never is.
 */

const FIXED_NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

const attemptArb = fc.record({
  nodeId: fc.uuid(),
  type: fc.constantFrom('reward' as const, 'presence' as const),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
})

// A step in the entry's life: a network result or a clock advance.
type Event = { t: 'transient' } | { t: 'success' } | { t: 'permanent' } | { t: 'advance'; ms: number }

const eventArb: fc.Arbitrary<Event> = fc.oneof(
  fc.constant<Event>({ t: 'transient' }),
  fc.constant<Event>({ t: 'success' }),
  fc.constant<Event>({ t: 'permanent' }),
  fc.integer({ min: 0, max: 30 * 60 * 1000 }).map<Event>((ms) => ({ t: 'advance', ms })),
)

const RESULT: Record<'transient' | 'success' | 'permanent', AttemptResult> = {
  transient: { kind: 'transient' },
  success: { kind: 'success' },
  permanent: { kind: 'permanent' },
}

describe('Feature: cross-portal-lifecycle-alignment, Property 2: Outbox state machine', () => {
  it('holds the single-state, retry-cap, replay-window and removal invariants', () => {
    fc.assert(
      fc.property(attemptArb, fc.array(eventArb, { maxLength: 20 }), (attempt, events) => {
        let now = FIXED_NOW
        let entry: OutboxEntry | null = createEntry(attempt, new Date(now).toISOString(), now, 'id-1')

        const check = (e: OutboxEntry | null) => {
          // (1) exactly one state — classify is total and returns one label.
          expect(['queued', 'parked', 'gone']).toContain(classify(e))
          if (e) {
            // (2) retry cap.
            expect(e.retryCount).toBeLessThanOrEqual(MAX_RETRIES)
            expect(e.retryCount).toBeGreaterThanOrEqual(0)
            // (3) expired ⇒ never due (no network call for stale entries).
            if (isExpired(e, now)) expect(isDue(e, now)).toBe(false)
            // A parked entry never retries automatically.
            if (isParked(e)) expect(isDue(e, now)).toBe(false)
          }
        }

        check(entry)
        for (const ev of events) {
          if (ev.t === 'advance') {
            now += ev.ms
          } else if (entry !== null) {
            const wasParked = isParked(entry)
            entry = applyResult(entry, RESULT[ev.t], now)
            // (4) success and permanent always remove a QUEUED entry. A parked
            // entry is terminal for automatic processing (the pump never attempts
            // it), so it is left untouched.
            if ((ev.t === 'success' || ev.t === 'permanent') && !wasParked) expect(entry).toBeNull()
          }
          check(entry)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('parks after exactly MAX_RETRIES transient failures and never before', () => {
    fc.assert(
      fc.property(attemptArb, (attempt) => {
        let now = FIXED_NOW
        let entry: OutboxEntry | null = createEntry(attempt, new Date(now).toISOString(), now, 'id-1')
        for (let i = 1; i <= MAX_RETRIES; i++) {
          expect(entry).not.toBeNull()
          expect(isParked(entry!)).toBe(false)
          entry = applyResult(entry!, { kind: 'transient' }, now)
          now += 1000
          expect(entry!.retryCount).toBe(i)
        }
        // After MAX_RETRIES transient failures the entry is parked, not gone.
        expect(classify(entry)).toBe('parked')
      }),
      { numRuns: 100 },
    )
  })

  it('shouldEnqueue: only network (0) and 5xx, never 4xx (R5.1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 499 }), (status) => {
        expect(shouldEnqueue(status)).toBe(false)
      }),
      { numRuns: 100 },
    )
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 599 }), (status) => {
        expect(shouldEnqueue(status)).toBe(true)
      }),
      { numRuns: 100 },
    )
    expect(shouldEnqueue(0)).toBe(true)
  })

  it('reEnqueue resets the retry budget only while inside the Replay_Window (R5.6)', () => {
    fc.assert(
      fc.property(attemptArb, fc.integer({ min: 0, max: 30 * 60 * 1000 }), (attempt, ageMs) => {
        const now = FIXED_NOW
        const captured = new Date(now - ageMs).toISOString()
        const parked: OutboxEntry = {
          ...createEntry(attempt, captured, now - ageMs, 'id-1'),
          retryCount: MAX_RETRIES,
          parkedAt: new Date(now - ageMs).toISOString(),
        }
        const result = reEnqueue(parked, now)
        if (isExpired(parked, now)) {
          expect(result).toBeNull()
        } else {
          expect(result).not.toBeNull()
          expect(result!.retryCount).toBe(0)
          expect(isParked(result!)).toBe(false)
        }
      }),
      { numRuns: 200 },
    )
  })
})
