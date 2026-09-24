// @vitest-environment jsdom
/**
 * Commit_Mode Venue_Open (proof-of-demand task 2.5, R2.1).
 *
 * `NodeDetailContent` is only mounted while the detail sheet is expanded, so its
 * mount effect is the "a consumer opened this venue" signal. Three things have
 * to hold for the owner's receipt to mean anything:
 *
 *  - the open is recorded once per open, not once per render
 *  - the source is `search` when the selection came from the Search_Sheet and
 *    `map` for every other in-app route into the sheet
 *  - a Browse_Mode card selection records nothing, which here shows up as: the
 *    open is tied to mounting this body, and a carousel step off the venue
 *    (which clears the selection source) does not turn into a `search` open
 *
 * The real `selectionStore` is driven through its own actions. Child surfaces
 * that hit the network, the camera, or a canvas are stubbed. No network.
 */
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { usePresenceStore } from '@area-code/shared/stores/presenceStore'
import { useSelectionStore } from '@area-code/shared/stores/selectionStore'
import type { Node, NodeState, Reward } from '@area-code/shared/types'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NodeDetailContent } from '../NodeDetailContent'

const mocks = vi.hoisted(() => ({ reportVenueOpen: vi.fn() }))

vi.mock('../../lib/venueOpen', () => ({ reportVenueOpen: mocks.reportVenueOpen }))
vi.mock('@area-code/shared/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../CrowdVibeSection', () => ({ CrowdVibeSection: () => <div data-crowd-vibe-stub /> }))
vi.mock('../QrScannerSheet', () => ({ QrScannerSheet: () => <div data-qr-stub /> }))
vi.mock('../DirectionsSheet', () => ({ DirectionsSheet: () => <div data-directions-stub /> }))
vi.mock('../ArchetypeGlyph', () => ({ ArchetypeGlyph: () => <div data-glyph-stub /> }))

const NODE: Node = {
  id: 'node-1',
  slug: 'test-venue',
  name: 'Test Venue',
  category: 'nightlife',
  lat: -26.2,
  lng: 28.04,
  claimStatus: 'unclaimed',
} as Node

const OTHER: Node = { ...NODE, id: 'node-2', slug: 'other-venue', name: 'Other Venue' }

const STATE: NodeState = 'buzzing'
const REWARDS: Reward[] = []

function renderDetail(node: Node | null = NODE) {
  return render(
    <NodeDetailContent
      node={node}
      rewards={REWARDS}
      pulseScore={42}
      state={STATE}
      onCheckIn={vi.fn()}
      onSignIn={vi.fn()}
    />,
  )
}

/** The source of the single recorded open. */
function recordedSource(): string {
  expect(mocks.reportVenueOpen).toHaveBeenCalledTimes(1)
  return (mocks.reportVenueOpen.mock.calls[0] as [Node, string])[1]
}

beforeEach(() => {
  mocks.reportVenueOpen.mockClear()
  useSelectionStore.getState().dismiss()
  usePresenceStore.getState().clear()
  useLocationStore.setState({ geoStatus: 'idle' })
  useConsumerAuthStore.setState({ isAuthenticated: true })
  useMapStore.setState({ archetypeIds: {} })
})

afterEach(() => {
  cleanup()
})

describe('NodeDetailContent Venue_Open', () => {
  it('records the open as `map` for a selection that did not come from search', () => {
    useSelectionStore.getState().selectVenue('node-1', 'marker')

    renderDetail()

    expect(recordedSource()).toBe('map')
    expect((mocks.reportVenueOpen.mock.calls[0] as [Node, string])[0].id).toBe('node-1')
  })

  it('records the open as `search` when the Search_Sheet made the selection', () => {
    useSelectionStore.getState().selectVenue('node-1', 'search')

    renderDetail()

    expect(recordedSource()).toBe('search')
  })

  it('records the open as `map` for a deep-link focus, which already recorded its own source', () => {
    useSelectionStore.getState().selectVenue('node-1', 'focus')

    renderDetail()

    expect(recordedSource()).toBe('map')
  })

  it('records once per open, not once per render', () => {
    useSelectionStore.getState().selectVenue('node-1', 'marker')

    const { rerender } = renderDetail()
    rerender(
      <NodeDetailContent
        node={NODE}
        rewards={REWARDS}
        pulseScore={99}
        state={STATE}
        onCheckIn={vi.fn()}
        onSignIn={vi.fn()}
      />,
    )

    expect(mocks.reportVenueOpen).toHaveBeenCalledTimes(1)
  })

  it('records a second open when the body switches to another venue', () => {
    useSelectionStore.getState().selectVenue('node-1', 'marker')

    const { rerender } = renderDetail()
    rerender(
      <NodeDetailContent
        node={OTHER}
        rewards={REWARDS}
        pulseScore={42}
        state={STATE}
        onCheckIn={vi.fn()}
        onSignIn={vi.fn()}
      />,
    )

    expect(mocks.reportVenueOpen).toHaveBeenCalledTimes(2)
    expect((mocks.reportVenueOpen.mock.calls[1] as [Node, string])[0].id).toBe('node-2')
  })

  it('records nothing when there is no venue to open', () => {
    renderDetail(null)

    expect(mocks.reportVenueOpen).not.toHaveBeenCalled()
  })

  it('does not carry a search source onto a venue reached by a carousel step', () => {
    const store = useSelectionStore.getState()
    store.setOrder(['node-1', 'node-2'])
    store.selectVenue('node-1', 'search')
    store.step(1)

    renderDetail(OTHER)

    expect(recordedSource()).toBe('map')
  })
})
