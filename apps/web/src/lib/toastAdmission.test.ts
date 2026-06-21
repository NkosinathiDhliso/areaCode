import type { Toast, ToastType } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { admitToQueue, shouldEnqueueCheckInToast, TOAST_PRIORITY, TOAST_QUEUE_CAP } from './toastAdmission'

/**
 * Map Discovery - toast admission property tests (deferred tasks 5.2, 5.3).
 *
 *   - Property 24: Toast queue is priority-ordered and capped
 *   - Property 25: Check_In_Toast deduplication within the auto-dismiss interval
 *
 * Validates: Requirements 16.1, 16.5, 16.6
 */

const TOAST_TYPES: ToastType[] = [
  'surge',
  'city_pulse',
  'reward_pressure',
  'checkin',
  'reward_new',
  'streak',
  'leaderboard',
]

const priorityOf = (t: Toast): number => TOAST_PRIORITY[t.type] ?? 5

function makeToast(type: ToastType, id: string): Toast {
  return { id, type, message: `Test ${type}`, priority: priorityOf({ type } as Toast), timestamp: 0 }
}

describe('Feature: map-discovery-experience, Property 24: Toast queue is priority-ordered and capped', () => {
  const seqArb = fc.array(fc.constantFrom(...TOAST_TYPES), { minLength: 0, maxLength: 20 })

  it('never exceeds the cap and stays priority-ordered after any admission sequence', () => {
    fc.assert(
      fc.property(seqArb, (types) => {
        let queue: Toast[] = []
        types.forEach((t, i) => {
          queue = admitToQueue(queue, makeToast(t, `t-${i}`))
        })
        expect(queue.length).toBeLessThanOrEqual(TOAST_QUEUE_CAP)
        for (let i = 1; i < queue.length; i++) {
          expect(priorityOf(queue[i - 1]!)).toBeLessThanOrEqual(priorityOf(queue[i]!))
        }
      }),
      { numRuns: 300 },
    )
  })

  it('keeps the highest-priority toasts - equivalent to a stable global top-N', () => {
    fc.assert(
      fc.property(seqArb, (types) => {
        const all: Toast[] = types.map((t, i) => makeToast(t, `t-${i}`))
        let queue: Toast[] = []
        all.forEach((toast) => {
          queue = admitToQueue(queue, toast)
        })

        const expected = all
          .map((t, i) => ({ t, i }))
          .sort((a, b) => priorityOf(a.t) - priorityOf(b.t) || a.i - b.i)
          .slice(0, TOAST_QUEUE_CAP)
          .map((o) => o.t.id)

        expect(queue.map((t) => t.id)).toEqual(expected)
      }),
      { numRuns: 300 },
    )
  })

  it('does not mutate the input queue', () => {
    const queue = [makeToast('checkin', 'a')]
    const snapshot = queue.map((t) => t.id)
    admitToQueue(queue, makeToast('surge', 'b'))
    expect(queue.map((t) => t.id)).toEqual(snapshot)
  })
})

describe('Feature: map-discovery-experience, Property 25: Check_In_Toast deduplication within the auto-dismiss interval', () => {
  it('admits iff the venue was never seen or its last toast is at least `interval` old', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 10_000_000 })),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 120_000 }),
        (venueId, lastSeenAt, now, interval) => {
          const last = lastSeenAt[venueId]
          const expected = last === undefined || !Number.isFinite(last) || now - last >= interval
          expect(shouldEnqueueCheckInToast(venueId, lastSeenAt, now, interval)).toBe(expected)
        },
      ),
    )
  })

  it('suppresses strictly inside the interval and admits exactly at the boundary', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 60_000 }),
        (venueId, lastTs, interval) => {
          const seen = { [venueId]: lastTs }
          expect(shouldEnqueueCheckInToast(venueId, seen, lastTs, interval)).toBe(false)
          expect(shouldEnqueueCheckInToast(venueId, seen, lastTs + interval - 1, interval)).toBe(false)
          expect(shouldEnqueueCheckInToast(venueId, seen, lastTs + interval, interval)).toBe(true)
        },
      ),
    )
  })
})
