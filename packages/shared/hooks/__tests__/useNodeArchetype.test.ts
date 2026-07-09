/**
 * R11 / R12 live archetype delivery tests (Live Vibe on Map § R12.4).
 *
 * Covers: cached value retained for ≤ 5 minutes after disconnect, reconnect
 * payload replaces the cache via `setNodes`, cache cleared for nodes the
 * reconnect payload omits.
 */
// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import { setSocketOverride } from '../../lib/websocket'
import { useMapStore } from '../../stores/mapStore'
import type { Node } from '../../types'
import { useNodeArchetype } from '../useNodeArchetype'

const RETENTION_MS = 5 * 60 * 1000

interface MockSocket {
  on: (event: string, handler: (...args: unknown[]) => void) => void
  off: (event: string, handler: (...args: unknown[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
  disconnect: () => void
  connected: boolean
  // Test hooks
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

function makeNode(id: string, liveArchetypeId?: string): Node {
  return {
    id,
    name: id,
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
    ...(liveArchetypeId !== undefined ? { liveArchetypeId } : {}),
  } as Node
}

function reset() {
  useMapStore.setState({ nodes: {}, archetypeIds: {} } as Partial<ReturnType<typeof useMapStore.getState>>)
}

beforeEach(() => {
  vi.useFakeTimers()
  reset()
  setSocketOverride(undefined)
})

describe('useNodeArchetype', () => {
  it('writes incoming node:archetype_change deltas into mapStore.archetypeIds (R11.2)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    renderHook(() => useNodeArchetype('token', { citySlug: 'jhb' }))
    socket.__fire('node:archetype_change', {
      nodeId: 'n1',
      liveArchetypeId: 'archetype-festival-spirit',
      branch: 'schedule_blanket',
    })
    expect(useMapStore.getState().archetypeIds['n1']).toBe('archetype-festival-spirit')
  })

  it('drops the cached id after the 5-minute retention window (R11.6)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    renderHook(() => useNodeArchetype('token'))
    socket.__fire('node:archetype_change', {
      nodeId: 'n1',
      liveArchetypeId: 'archetype-festival-spirit',
      branch: 'default',
    })
    expect(useMapStore.getState().archetypeIds['n1']).toBe('archetype-festival-spirit')
    // Just before TTL - still cached.
    vi.advanceTimersByTime(RETENTION_MS - 1)
    expect(useMapStore.getState().archetypeIds['n1']).toBe('archetype-festival-spirit')
    // Past TTL - cleared.
    vi.advanceTimersByTime(2)
    expect(useMapStore.getState().archetypeIds['n1']).toBeUndefined()
  })

  it('replaces the cache from the next live nodes payload on reconnect (R11.7)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    renderHook(() => useNodeArchetype('token'))
    // Seed an initial archetype via a delta.
    socket.__fire('node:archetype_change', {
      nodeId: 'n1',
      liveArchetypeId: 'archetype-festival-spirit',
      branch: 'default',
    })
    // Reconnect: setNodes is called with the live nodes payload.
    useMapStore.getState().setNodes([makeNode('n1', 'archetype-township-royal'), makeNode('n2', 'archetype-eclectic')])
    expect(useMapStore.getState().archetypeIds['n1']).toBe('archetype-township-royal')
    expect(useMapStore.getState().archetypeIds['n2']).toBe('archetype-eclectic')
  })

  it('clears the cache for a node the reconnect payload omits liveArchetypeId for (R11.7)', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    renderHook(() => useNodeArchetype('token'))
    socket.__fire('node:archetype_change', {
      nodeId: 'n1',
      liveArchetypeId: 'archetype-festival-spirit',
      branch: 'default',
    })
    // Reconnect with the node still visible but no liveArchetypeId.
    useMapStore.getState().setNodes([makeNode('n1')])
    expect(useMapStore.getState().archetypeIds['n1']).toBeUndefined()
  })

  it('tears down the socket listener and timers on unmount', () => {
    const socket = makeMockSocket()
    setSocketOverride(socket)
    const { unmount } = renderHook(() => useNodeArchetype('token'))
    socket.__fire('node:archetype_change', {
      nodeId: 'n1',
      liveArchetypeId: 'archetype-festival-spirit',
      branch: 'default',
    })
    expect(useMapStore.getState().archetypeIds['n1']).toBe('archetype-festival-spirit')
    unmount()
    // No further deltas should land after teardown.
    socket.__fire('node:archetype_change', {
      nodeId: 'n1',
      liveArchetypeId: 'archetype-uncharted',
      branch: 'default',
    })
    expect(useMapStore.getState().archetypeIds['n1']).toBe('archetype-festival-spirit')
  })
})
