// @vitest-environment jsdom
/**
 * Tests for useVenueArrival - share / push deep-link arrival landing on the
 * venue card (proof-of-demand task 1.6, R1.1, R1.5, R1.7).
 *
 * Covers:
 * - A stashed slug resolves to a node id and is handed to the Focus_Signal
 *   path (`setFocusNodeId`), which is what opens Browse_Mode with the venue as
 *   the Active_Venue. Commit_Mode is never opened here.
 * - The stash survives an unauthenticated arrival (the source must outlive the
 *   login round trip) and is cleared on the first authenticated pass.
 * - A slug the city payload does not carry releases the stash, so the normal
 *   cold open is never blocked.
 * - Nothing happens before the map is ready or without a stash.
 *
 * The real stores are driven via `setState`/`getState` and reset in
 * `beforeEach`. No network, no Mapbox.
 */
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { Node } from '@area-code/shared/types'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hasPendingVenueArrival, stashVenueArrival } from '../../lib/venueArrival'
import { useVenueArrival } from '../useVenueArrival'

const mocks = vi.hoisted(() => ({ reportVenueOpen: vi.fn() }))

vi.mock('../../lib/venueOpen', () => ({ reportVenueOpen: mocks.reportVenueOpen }))

function node(id: string, slug: string): Node {
  return { id, slug, name: `Venue ${id}`, category: 'nightlife', lat: -26.2, lng: 28.04 } as Node
}

function loadCity(): void {
  useMapStore.getState().setNodes([node('n1', 'great-dane'), node('n2', 'kitchener')])
}

beforeEach(() => {
  sessionStorage.clear()
  useMapStore.setState({ nodes: {}, focusNodeId: null })
  useConsumerAuthStore.setState({ isAuthenticated: false })
  mocks.reportVenueOpen.mockClear()
})

describe('useVenueArrival', () => {
  it('focuses the stashed venue once the city payload carries it', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'share' })
    loadCity()

    renderHook(() => useVenueArrival(true))

    expect(useMapStore.getState().focusNodeId).toBe('n1')
  })

  it('keeps the stash while unauthenticated so the source survives sign-in', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'push' })
    loadCity()

    renderHook(() => useVenueArrival(true))

    expect(hasPendingVenueArrival()).toBe(true)
  })

  it('re-focuses the venue and clears the stash once authenticated', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'share' })
    loadCity()

    const { rerender } = renderHook(() => useVenueArrival(true))
    useMapStore.setState({ focusNodeId: null })

    useConsumerAuthStore.setState({ isAuthenticated: true })
    rerender()

    expect(useMapStore.getState().focusNodeId).toBe('n1')
    expect(hasPendingVenueArrival()).toBe(false)
  })

  it('waits for the city payload before deciding', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'share' })
    useConsumerAuthStore.setState({ isAuthenticated: true })

    const { rerender } = renderHook(() => useVenueArrival(true))
    expect(useMapStore.getState().focusNodeId).toBeNull()
    expect(hasPendingVenueArrival()).toBe(true)

    loadCity()
    rerender()

    expect(useMapStore.getState().focusNodeId).toBe('n1')
  })

  it('releases the stash when the city payload does not carry the slug', () => {
    stashVenueArrival({ slug: 'somewhere-else', source: 'share' })
    loadCity()

    renderHook(() => useVenueArrival(true))

    expect(useMapStore.getState().focusNodeId).toBeNull()
    expect(hasPendingVenueArrival()).toBe(false)
  })

  it('does nothing before the map is ready', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'share' })
    loadCity()
    useConsumerAuthStore.setState({ isAuthenticated: true })

    renderHook(() => useVenueArrival(false))

    expect(useMapStore.getState().focusNodeId).toBeNull()
    expect(hasPendingVenueArrival()).toBe(true)
  })

  it('does nothing without a stash', () => {
    loadCity()

    renderHook(() => useVenueArrival(true))

    expect(useMapStore.getState().focusNodeId).toBeNull()
  })
})

/**
 * The arrival is the only place a `share` or `push` open is recorded (task 2.5,
 * R2.1). It must carry the source the link arrived with, wait for the consumer
 * session, and fire exactly once even though the effect re-runs on every nodes
 * update.
 */
describe('useVenueArrival - Venue_Open (R2.1)', () => {
  it('records the open with the stashed source once authenticated', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'share' })
    loadCity()
    useConsumerAuthStore.setState({ isAuthenticated: true })

    renderHook(() => useVenueArrival(true))

    expect(mocks.reportVenueOpen).toHaveBeenCalledTimes(1)
    const [venue, source] = mocks.reportVenueOpen.mock.calls[0] as [{ id: string }, string]
    expect(venue.id).toBe('n1')
    expect(source).toBe('share')
  })

  it('preserves a push source across the login round trip', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'push' })
    loadCity()

    const { rerender } = renderHook(() => useVenueArrival(true))
    expect(mocks.reportVenueOpen).not.toHaveBeenCalled()

    useConsumerAuthStore.setState({ isAuthenticated: true })
    rerender()

    expect(mocks.reportVenueOpen).toHaveBeenCalledTimes(1)
    expect(mocks.reportVenueOpen.mock.calls[0]?.[1]).toBe('push')
  })

  it('records one open per arrival, not one per nodes update', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'share' })
    loadCity()
    useConsumerAuthStore.setState({ isAuthenticated: true })

    const { rerender } = renderHook(() => useVenueArrival(true))
    useMapStore.getState().setNodes([node('n1', 'great-dane'), node('n3', 'the-baron')])
    rerender()

    expect(mocks.reportVenueOpen).toHaveBeenCalledTimes(1)
  })

  it('records nothing for a slug the city payload does not carry', () => {
    stashVenueArrival({ slug: 'somewhere-else', source: 'share' })
    loadCity()
    useConsumerAuthStore.setState({ isAuthenticated: true })

    renderHook(() => useVenueArrival(true))

    expect(mocks.reportVenueOpen).not.toHaveBeenCalled()
  })
})
