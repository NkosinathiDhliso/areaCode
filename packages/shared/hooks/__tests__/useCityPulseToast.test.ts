/**
 * R2 City Pulse toast behaviour (Live Vibe on Map § R2, R10.4).
 *
 * Validates: once-per-session enqueue, 2000ms grace, 6000ms auto-dismiss,
 * the re-surface threshold (< 60 → ≥ 60), suppression on totalPulse === 0,
 * and suppression on no-node-data without consuming the once-per-session
 * slot.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useCityPulseToast } from '../useCityPulseToast'
import { useMapStore } from '../../stores/mapStore'
import { useToastStore } from '../../stores/toastStore'
import type { Node } from '../../types'

const TOAST_ID = 'city-pulse'
const GRACE_MS = 2000
const AUTO_DISMISS_MS = 6000

function makeNode(id: string): Node {
  return {
    id,
    name: `Node ${id}`,
    slug: id,
    category: 'food',
    lat: 0,
    lng: 0,
    cityId: 'jhb',
    businessId: null,
    submittedBy: null,
    claimStatus: 'unclaimed',
    claimCipcStatus: null,
    nodeColour: 'default',
    nodeIcon: null,
    qrCheckinEnabled: false,
    isVerified: false,
    isActive: true,
    createdAt: '',
  }
}

function resetStores() {
  useMapStore.setState({ nodes: {}, pulseScores: {} } as Partial<ReturnType<typeof useMapStore.getState>>)
  useToastStore.setState({ queue: [] } as Partial<ReturnType<typeof useToastStore.getState>>)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetStores()
})

describe('useCityPulseToast', () => {
  it('enqueues exactly one city_pulse toast after the 2000ms grace (R2.1)', () => {
    useMapStore.setState({ nodes: { n1: makeNode('n1') }, pulseScores: { n1: 42 } })
    renderHook(() => useCityPulseToast({ mapReady: true }))
    // Before grace elapses no toast should have been enqueued.
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 10)
    })
    const toast = useToastStore.getState().queue.find((t) => t.id === TOAST_ID)
    expect(toast).toBeDefined()
    expect(toast?.type).toBe('city_pulse')
  })

  it('auto-dismisses the toast after 6000ms (R2.4)', () => {
    useMapStore.setState({ nodes: { n1: makeNode('n1') }, pulseScores: { n1: 50 } })
    renderHook(() => useCityPulseToast({ mapReady: true }))
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeDefined()
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()
  })

  it('does not enqueue when mapReady is false (R2.5)', () => {
    useMapStore.setState({ nodes: { n1: makeNode('n1') }, pulseScores: { n1: 50 } })
    renderHook(() => useCityPulseToast({ mapReady: false }))
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 1000)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()
  })

  it('suppresses when totalPulse === 0 without consuming the once-per-session slot (R2.9)', () => {
    useMapStore.setState({ nodes: { n1: makeNode('n1') }, pulseScores: { n1: 0 } })
    const { rerender } = renderHook(({ ready }: { ready: boolean }) => useCityPulseToast({ mapReady: ready }), {
      initialProps: { ready: true },
    })
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()

    // Now bump totalPulse above 0 - the once-per-session slot is still
    // available so the next grace window enqueues. We simulate "first
    // paint" by re-toggling mapReady so the grace effect re-runs.
    act(() => {
      useMapStore.setState({ pulseScores: { n1: 80 } })
    })
    rerender({ ready: false })
    rerender({ ready: true })
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeDefined()
  })

  it('suppresses without consuming the slot when there is no node data (R2.10)', () => {
    // pulseScores present, but nodes empty - mirrors a transient retrieval failure.
    useMapStore.setState({ nodes: {}, pulseScores: {} })
    const { rerender } = renderHook(({ ready }: { ready: boolean }) => useCityPulseToast({ mapReady: ready }), {
      initialProps: { ready: true },
    })
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()

    act(() => {
      useMapStore.setState({ nodes: { n1: makeNode('n1') }, pulseScores: { n1: 30 } })
    })
    rerender({ ready: false })
    rerender({ ready: true })
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeDefined()
  })

  it('re-surfaces exactly once when totalPulse crosses from < 60 → ≥ 60 (R2.6)', () => {
    useMapStore.setState({ nodes: { n1: makeNode('n1') }, pulseScores: { n1: 20 } })
    renderHook(() => useCityPulseToast({ mapReady: true }))
    act(() => {
      vi.advanceTimersByTime(GRACE_MS + 10)
    })
    // First surfacing happened.
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeDefined()
    // Dismiss / auto-dismiss.
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()

    // Cross the threshold from below 60 → above 60.
    act(() => {
      useMapStore.setState({ pulseScores: { n1: 75 } })
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeDefined()

    // A second cross should NOT re-surface (once per session, R2.6).
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS + 10)
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()
    act(() => {
      useMapStore.setState({ pulseScores: { n1: 30 } })
    })
    act(() => {
      useMapStore.setState({ pulseScores: { n1: 90 } })
    })
    expect(useToastStore.getState().queue.find((t) => t.id === TOAST_ID)).toBeUndefined()
  })
})
