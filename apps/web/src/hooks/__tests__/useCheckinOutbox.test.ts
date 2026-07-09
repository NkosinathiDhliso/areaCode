/**
 * Tests for useCheckinOutbox pump hook (cross-portal-lifecycle-alignment R5.1, R5.2).
 *
 * Covers:
 * - Drains the queue once on mount
 * - Re-drains on the pump interval
 * - Re-drains when the browser fires `online`
 * - Gated off when not authenticated (no pump, no listener)
 * - Toasts honestly when aged-out entries are discarded (R5.4)
 * - Cleans up the interval and the `online` listener on unmount
 */
// @vitest-environment jsdom
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCheckinOutbox } from '../useCheckinOutbox'
import { useCheckinOutboxStore } from '../../stores/checkinOutboxStore'

// The pump reads the store's `pump` action; drive it through a spy so the test
// stays free of the API client and localStorage.
function mockPump(result: { discarded: number } = { discarded: 0 }) {
  const pump = vi.fn().mockResolvedValue(result)
  useCheckinOutboxStore.setState({ pump })
  return pump
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  useErrorStore.setState({ error: null })
})

afterEach(() => {
  // Unmount any hooks still mounted so their intervals/listeners do not leak
  // into the next test and inflate the pump call count.
  cleanup()
  vi.useRealTimers()
})

describe('useCheckinOutbox (R5.1, R5.2)', () => {
  it('drains the queue once on mount', async () => {
    const pump = mockPump()

    renderHook(() => useCheckinOutbox(true))
    await vi.advanceTimersByTimeAsync(0)

    expect(pump).toHaveBeenCalledTimes(1)
  })

  it('re-drains on the pump interval', async () => {
    const pump = mockPump()

    renderHook(() => useCheckinOutbox(true))
    await vi.advanceTimersByTimeAsync(0)
    expect(pump).toHaveBeenCalledTimes(1)

    // One interval tick (20s) triggers another drain.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(pump).toHaveBeenCalledTimes(2)
  })

  it('re-drains when the browser comes back online', async () => {
    const pump = mockPump()

    renderHook(() => useCheckinOutbox(true))
    await vi.advanceTimersByTimeAsync(0)
    expect(pump).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(pump).toHaveBeenCalledTimes(2)
  })

  it('does not pump or listen while signed out', async () => {
    const pump = mockPump()

    renderHook(() => useCheckinOutbox(false))
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(20_000)

    expect(pump).not.toHaveBeenCalled()
  })

  it('toasts honestly when aged-out entries are discarded (R5.4)', async () => {
    mockPump({ discarded: 2 })

    renderHook(() => useCheckinOutbox(true))
    await vi.advanceTimersByTimeAsync(0)

    expect(useErrorStore.getState().error).toBe('2 check-ins were too old to record and have been discarded.')
  })

  it('uses singular copy when a single entry is discarded (R5.4)', async () => {
    mockPump({ discarded: 1 })

    renderHook(() => useCheckinOutbox(true))
    await vi.advanceTimersByTimeAsync(0)

    expect(useErrorStore.getState().error).toBe('A check-in was too old to record and has been discarded.')
  })

  it('cleans up the interval and online listener on unmount', async () => {
    const pump = mockPump()

    const { unmount } = renderHook(() => useCheckinOutbox(true))
    await vi.advanceTimersByTimeAsync(0)
    expect(pump).toHaveBeenCalledTimes(1)

    unmount()

    // Neither an interval tick nor an online event pumps after unmount.
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pump).toHaveBeenCalledTimes(1)
  })
})
