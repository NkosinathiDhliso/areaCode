/**
 * One home for "schedule a timeout that cannot outlive the component".
 *
 * A `setTimeout` started inside an async handler keeps running after the
 * component unmounts, and its callback then writes state into a component that
 * is gone. `useSafeTimeout` hands back a `setSafeTimeout` that registers every
 * timer it creates and clears all of them on unmount (R15.25, and the
 * code-style rule that effects and subscriptions clean up on unmount).
 *
 * Usage:
 *   const setSafeTimeout = useSafeTimeout()
 *   setSafeTimeout(() => setSuccess(false), 5000)
 *
 * Validates: Requirements 15.25
 */

import { useCallback, useEffect, useRef } from 'react'

type TimerId = ReturnType<typeof setTimeout>

/** Schedules a callback and returns the timer id, as `setTimeout` does. */
export type SafeTimeoutScheduler = (callback: () => void, delayMs: number) => TimerId

/**
 * Returns a stable `setTimeout` wrapper whose timers are cleared when the
 * calling component unmounts.
 */
export function useSafeTimeout(): SafeTimeoutScheduler {
  const timersRef = useRef<Set<TimerId>>(new Set())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const id of timers) clearTimeout(id)
      timers.clear()
    }
  }, [])

  return useCallback((callback: () => void, delayMs: number): TimerId => {
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      callback()
    }, delayMs)
    timersRef.current.add(id)
    return id
  }, [])
}
