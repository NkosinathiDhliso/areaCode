// @vitest-environment jsdom
import { useConnectivityStore, useConsumerAuthStore, useMapStore, useSelectionStore } from '@area-code/shared/stores'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { Node } from '@area-code/shared/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCheckInFlow } from '../useCheckInFlow'

/**
 * Map Discovery — Commit_Mode check-in flow tests (deferred tasks 16.2-16.4).
 *
 *   - Property 22: In-progress check-in prevents duplicate submissions
 *   - Property 30: Offline check-in fails safe
 *   - Property 31: No phone-number or SMS input on any map auth entry
 *
 * `useCheckIn` and `useGeolocation` are mocked; the consumer-auth, connectivity,
 * map, selection, and error stores are driven through their real setState.
 *
 * Validates: Requirements 14.3, 14.5, 14.6, 14.8, 19.3, 20.1
 */

// `vi.hoisted` so the module mock factory can reference the shared mock state.
const mock = vi.hoisted(() => ({
  state: {
    checkIn: vi.fn(),
    isPending: false,
    qrFallback: false,
    resetQrFallback: vi.fn(),
    requestLocation: vi.fn(),
    geoStatus: 'acquired' as string,
  },
}))

vi.mock('@area-code/shared/hooks', () => ({
  useCheckIn: () => ({
    checkIn: mock.state.checkIn,
    isPending: mock.state.isPending,
    qrFallback: mock.state.qrFallback,
    resetQrFallback: mock.state.resetQrFallback,
  }),
  useGeolocation: () => ({
    requestLocation: mock.state.requestLocation,
    geoStatus: mock.state.geoStatus,
  }),
}))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mock.state.checkIn = vi.fn().mockResolvedValue(true)
  mock.state.resetQrFallback = vi.fn()
  mock.state.requestLocation = vi.fn().mockResolvedValue({ lat: -26.2, lng: 28.04 })
  mock.state.isPending = false
  mock.state.qrFallback = false
  mock.state.geoStatus = 'acquired'

  useConsumerAuthStore.setState({ isAuthenticated: true })
  useConnectivityStore.setState({ state: 'online' })
  useErrorStore.setState({ showError: vi.fn() })
  useMapStore.setState({ nodes: { a: { id: 'a', category: 'nightlife' } as Node } })
  useSelectionStore.setState({
    activeVenueId: 'a',
    mode: 'commit',
    carouselOrder: ['a'],
    openedFromFocus: false,
    lastVenueId: null,
  })
})

describe('Feature: map-discovery-experience, Property 22: In-progress check-in prevents duplicate submissions', () => {
  it('submits exactly one check-in for two rapid activations', async () => {
    let resolveCheckIn: (v: boolean) => void = () => {}
    mock.state.checkIn = vi.fn().mockImplementation(() => new Promise<boolean>((res) => (resolveCheckIn = res)))

    const { result } = renderHook(() => useCheckInFlow())

    await act(async () => {
      result.current.activateCheckIn()
      result.current.activateCheckIn()
      await flush()
    })

    expect(mock.state.checkIn).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveCheckIn(true)
      await flush()
    })
  })
})

describe('Feature: map-discovery-experience, Property 30: Offline check-in fails safe', () => {
  it('surfaces an error and never submits when offline', async () => {
    useConnectivityStore.setState({ state: 'offline' })

    const { result } = renderHook(() => useCheckInFlow())

    await act(async () => {
      result.current.activateCheckIn()
      await flush()
    })

    expect(mock.state.checkIn).not.toHaveBeenCalled()
    expect(useErrorStore.getState().showError).toHaveBeenCalled()
  })
})

describe('Feature: map-discovery-experience, Property 31: No phone/SMS input on any map auth entry', () => {
  it('opens the email/password + Google SignupSheet and submits nothing when unauthenticated', () => {
    useConsumerAuthStore.setState({ isAuthenticated: false })

    const { result } = renderHook(() => useCheckInFlow())
    expect(result.current.signupOpen).toBe(false)

    act(() => {
      result.current.activateCheckIn()
    })

    expect(result.current.signupOpen).toBe(true)
    expect(result.current.qrScannerOpen).toBe(false)
    expect(mock.state.checkIn).not.toHaveBeenCalled()
  })
})

describe('Map Discovery — scanned QR routing (R14.5, R14.6)', () => {
  it('rejects an invalid QR with an error and no check-in', async () => {
    const { result } = renderHook(() => useCheckInFlow())

    await act(async () => {
      result.current.onQrScanned('not-a-venue-qr')
      await flush()
    })

    expect(mock.state.checkIn).not.toHaveBeenCalled()
    expect(useErrorStore.getState().showError).toHaveBeenCalled()
  })

  it('routes a valid venue QR to a check-in carrying the scanned token', async () => {
    const { result } = renderHook(() => useCheckInFlow())

    await act(async () => {
      result.current.onQrScanned('https://areacode.co.za/qr/node-9/tok-123')
      await flush()
    })

    expect(mock.state.checkIn).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'node-9', qrToken: 'tok-123', type: 'reward' }),
    )
  })
})
