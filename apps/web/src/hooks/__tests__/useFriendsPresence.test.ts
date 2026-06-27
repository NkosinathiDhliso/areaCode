/**
 * Tests for useFriendsPresence hook - socket events and API seeding.
 *
 * Covers:
 * - toast:friend_checkin -> addFriendPresence (R3.4)
 * - friend:checkout -> removeFriendPresence (R3.4)
 * - Seed from GET /v1/friends/presence on auth (R3.1, R3.5)
 * - Re-seed on socket reconnect (R3.5)
 * - Clear store on logout (R3.3)
 * - No polling (R14.1)
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { setSocketOverride } from '@area-code/shared/lib/websocket'

import { useFriendsPresence } from '../useFriendsPresence'

// --- Mock API ---
vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

import { api } from '@area-code/shared/lib/api'
const mockApiGet = vi.mocked(api.get)

// --- Mock socket ---
interface MockSocket {
  on: (event: string, handler: (...args: unknown[]) => void) => void
  off: (event: string, handler: (...args: unknown[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
  disconnect: () => void
  connected: boolean
  __fire: (event: string, payload: unknown) => void
}

function makeMockSocket(): MockSocket {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler)
    },
    emit() {
      /* unused */
    },
    disconnect() {
      /* unused */
    },
    connected: true,
    __fire(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useMapStore.setState({ friendsAtVenue: {} })
  useConsumerAuthStore.setState({
    isAuthenticated: false,
    accessToken: null,
    refreshToken: null,
    userId: null,
    sessionId: null,
  })
  setSocketOverride(undefined)
})

describe('useFriendsPresence', () => {
  it('seeds friends presence from API on auth and filters expired entries (R3.1, R3.5)', async () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    useConsumerAuthStore.setState({ isAuthenticated: true, accessToken: 'tok' })

    const now = Date.now()
    mockApiGet.mockResolvedValueOnce({
      items: [
        { nodeId: 'n1', userId: 'u-a', expiresAt: new Date(now + 60_000).toISOString() },
        { nodeId: 'n1', userId: 'u-b', expiresAt: new Date(now + 60_000).toISOString() },
        { nodeId: 'n2', userId: 'u-c', expiresAt: new Date(now + 60_000).toISOString() },
        // Expired - must be filtered
        { nodeId: 'n3', userId: 'u-d', expiresAt: new Date(now - 60_000).toISOString() },
      ],
    })

    renderHook(() => useFriendsPresence('tok'))

    await vi.waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/v1/friends/presence')
    })

    await vi.waitFor(() => {
      const state = useMapStore.getState().friendsAtVenue
      expect(state['n1']).toEqual(['u-a', 'u-b'])
      expect(state['n2']).toEqual(['u-c'])
      expect(state['n3']).toBeUndefined()
    })
  })

  it('adds friend presence on toast:friend_checkin event (R3.4)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    useConsumerAuthStore.setState({ isAuthenticated: true, accessToken: 'tok' })
    mockApiGet.mockResolvedValueOnce({ items: [] })

    renderHook(() => useFriendsPresence('tok'))

    socket.__fire('toast:friend_checkin', {
      type: 'checkin',
      message: 'Alice checked in',
      userId: 'u-alice',
      nodeId: 'venue-1',
      avatarUrl: 'https://example.com/avatar.jpg',
    })

    expect(useMapStore.getState().friendsAtVenue['venue-1']).toEqual(['u-alice'])
  })

  it('removes friend presence on friend:checkout event (R3.4)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    useMapStore.setState({ friendsAtVenue: { 'venue-1': ['u-alice', 'u-bob'] } })
    useConsumerAuthStore.setState({ isAuthenticated: true, accessToken: 'tok' })
    mockApiGet.mockResolvedValueOnce({ items: [] })

    renderHook(() => useFriendsPresence('tok'))

    socket.__fire('friend:checkout', { userId: 'u-alice', nodeId: 'venue-1' })

    expect(useMapStore.getState().friendsAtVenue['venue-1']).toEqual(['u-bob'])
  })

  it('clears friends presence when unauthenticated (R3.3)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    useMapStore.setState({ friendsAtVenue: { 'venue-1': ['u-a'] } })
    // Unauthenticated
    useConsumerAuthStore.setState({ isAuthenticated: false, accessToken: null })

    renderHook(() => useFriendsPresence(undefined))

    expect(useMapStore.getState().friendsAtVenue).toEqual({})
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it('re-seeds from API on socket reconnect (recovers missed checkouts)', async () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    useConsumerAuthStore.setState({ isAuthenticated: true, accessToken: 'tok' })

    // Initial seed
    mockApiGet.mockResolvedValueOnce({ items: [] })

    renderHook(() => useFriendsPresence('tok'))

    await vi.waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(1)
    })

    // Simulate reconnect
    const now = Date.now()
    mockApiGet.mockResolvedValueOnce({
      items: [{ nodeId: 'n5', userId: 'u-x', expiresAt: new Date(now + 60_000).toISOString() }],
    })

    socket.__fire('connect', undefined)

    await vi.waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(2)
    })

    await vi.waitFor(() => {
      expect(useMapStore.getState().friendsAtVenue['n5']).toEqual(['u-x'])
    })
  })

  it('does not register socket listeners when unauthenticated (R14.1)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    useConsumerAuthStore.setState({ isAuthenticated: false, accessToken: null })

    renderHook(() => useFriendsPresence(undefined))

    // Fire events - they should have no effect
    socket.__fire('toast:friend_checkin', {
      type: 'checkin',
      message: 'test',
      userId: 'u-x',
      nodeId: 'n-x',
    })

    expect(useMapStore.getState().friendsAtVenue).toEqual({})
  })

  it('tears down socket listeners on unmount', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    useConsumerAuthStore.setState({ isAuthenticated: true, accessToken: 'tok' })
    mockApiGet.mockResolvedValueOnce({ items: [] })

    const { unmount } = renderHook(() => useFriendsPresence('tok'))

    // Verify listener is active
    socket.__fire('toast:friend_checkin', {
      type: 'checkin',
      message: 'test',
      userId: 'u-a',
      nodeId: 'n-a',
    })
    expect(useMapStore.getState().friendsAtVenue['n-a']).toEqual(['u-a'])

    unmount()

    // After unmount, events should not affect store
    socket.__fire('toast:friend_checkin', {
      type: 'checkin',
      message: 'test',
      userId: 'u-b',
      nodeId: 'n-b',
    })
    expect(useMapStore.getState().friendsAtVenue['n-b']).toBeUndefined()
  })
})
