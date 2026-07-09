import * as fc from 'fast-check'
import { describe, it, expect, beforeEach } from 'vitest'

import type { Toast, ToastType } from '../../types'
import { useToastStore } from '../toastStore'

const TOAST_TYPES: ToastType[] = [
  'surge',
  'city_pulse',
  'reward_pressure',
  'friend_checkin',
  'checkin',
  'reward_new',
  'streak',
  'leaderboard',
]

const PRIORITY_MAP: Record<ToastType, number> = {
  surge: 1,
  city_pulse: 2,
  reward_pressure: 3,
  friend_checkin: 3,
  checkin: 4,
  reward_new: 4,
  streak: 5,
  leaderboard: 5,
}

function makeToast(type: ToastType, id: string): Toast {
  return {
    id,
    type,
    message: `Test ${type}`,
    priority: PRIORITY_MAP[type],
    timestamp: Date.now(),
  }
}

describe('toast queue management', () => {
  beforeEach(() => {
    useToastStore.setState({ queue: [], isBottomSheetOpen: false })
  })

  /**
   * Property 13: Toast queue never exceeds 3 items.
   * After any sequence of toast additions, queue length is always ≤ 3.
   * Validates: Requirements 8.4
   */
  it('queue never exceeds 3 items', () => {
    const toastTypeArb = fc.constantFrom(...TOAST_TYPES)

    fc.assert(
      fc.property(fc.array(toastTypeArb, { minLength: 1, maxLength: 20 }), (types) => {
        useToastStore.setState({ queue: [] })

        for (let i = 0; i < types.length; i++) {
          useToastStore.getState().addToast(makeToast(types[i]!, `t-${i}`))
          expect(useToastStore.getState().queue.length).toBeLessThanOrEqual(3)
        }
      }),
      { numRuns: 300 },
    )
  })

  /**
   * Property 14: Surge toasts always preempt lower-priority toasts.
   * A surge toast is always at the front of the queue.
   * Validates: Requirements 8.1
   */
  it('surge toast is always at the front of the queue', () => {
    const nonSurgeTypeArb = fc.constantFrom(
      'reward_pressure' as ToastType,
      'checkin' as ToastType,
      'reward_new' as ToastType,
      'streak' as ToastType,
      'leaderboard' as ToastType,
    )

    fc.assert(
      fc.property(fc.array(nonSurgeTypeArb, { minLength: 1, maxLength: 5 }), (priorTypes) => {
        useToastStore.setState({ queue: [] })

        // Add non-surge toasts first
        for (let i = 0; i < priorTypes.length; i++) {
          useToastStore.getState().addToast(makeToast(priorTypes[i]!, `prior-${i}`))
        }

        // Add a surge toast
        useToastStore.getState().addToast(makeToast('surge', 'surge-1'))

        const queue = useToastStore.getState().queue
        expect(queue[0]?.type).toBe('surge')
      }),
      { numRuns: 200 },
    )
  })

  it('queue is sorted by priority (lower number = higher priority)', () => {
    const toastTypeArb = fc.constantFrom(...TOAST_TYPES)

    fc.assert(
      fc.property(fc.array(toastTypeArb, { minLength: 2, maxLength: 5 }), (types) => {
        useToastStore.setState({ queue: [] })

        for (let i = 0; i < types.length; i++) {
          useToastStore.getState().addToast(makeToast(types[i]!, `t-${i}`))
        }

        const queue = useToastStore.getState().queue
        for (let i = 1; i < queue.length; i++) {
          expect(queue[i - 1]!.priority).toBeLessThanOrEqual(queue[i]!.priority)
        }
      }),
      { numRuns: 300 },
    )
  })
})
