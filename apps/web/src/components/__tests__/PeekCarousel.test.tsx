// @vitest-environment jsdom
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useSelectionStore } from '@area-code/shared/stores/selectionStore'
import type { Node, NodeState } from '@area-code/shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UseCarouselSelectionResult } from '../../hooks/useCarouselSelection'
import type { VenueCardVM } from '../../lib/carouselConstants'
import { PeekCarousel } from '../PeekCarousel'

/**
 * Map Discovery - PeekCarousel render + mode-transition tests (tasks 11.2, 11.3).
 *
 *   - Property 14: Active_Venue change is announced to assistive technology
 *   - Browse <-> Commit transitions on the same Bottom_Sheet, keyboard controls
 *
 * BottomSheet and NodeDetailContent are stubbed so the test targets the
 * carousel's own wiring (announcer, card taps, mode controls) rather than the
 * detail body or the sheet chrome.
 *
 * Validates: Requirements 1.1, 2.1, 2.2, 2.4, 2.5, 4.2, 8.3, 8.4
 */

vi.mock('@area-code/shared/components/BottomSheet', () => ({
  BottomSheet: ({ children }) => <div data-bottomsheet>{children}</div>,
}))
vi.mock('../NodeDetailContent', () => ({
  NodeDetailContent: () => <div data-node-detail-stub />,
}))

afterEach(cleanup)
beforeEach(() => {
  useMapStore.setState({
    nodes: {
      a: { id: 'a', category: 'nightlife' } as Node,
      b: { id: 'b', category: 'nightlife' } as Node,
    },
  })
  useSelectionStore.setState({
    activeVenueId: 'a',
    mode: 'browse',
    carouselOrder: ['a', 'b'],
    openedFromFocus: false,
    lastVenueId: null,
  })
})

function vm(id: string, over: Partial<VenueCardVM> = {}): VenueCardVM {
  return {
    id,
    name: `Venue ${id}`,
    liveCheckInCount: 5,
    pulseState: 'buzzing',
    archetypeId: 'archetype-festival-spirit',
    isFirstIn: false,
    ...over,
  }
}

function makeSelection(over: Partial<UseCarouselSelectionResult> = {}): UseCarouselSelectionResult {
  return {
    mode: 'browse',
    activeVenueId: 'a',
    activeVenue: { id: 'a' } as Node,
    activeVenueVM: vm('a'),
    carouselOrderVMs: [vm('a'), vm('b')],
    openedFromFocus: false,
    onSwipe: vi.fn(),
    selectVenue: vi.fn(),
    enterCommit: vi.fn(),
    enterBrowse: vi.fn(),
    dismiss: vi.fn(),
    setSwipeInProgress: vi.fn(),
    browseScope: 'recommended',
    showRecommended: vi.fn(),
    ...over,
  } as UseCarouselSelectionResult
}

function renderCarousel(over: Partial<UseCarouselSelectionResult> = {}) {
  return render(
    <PeekCarousel
      selection={makeSelection(over)}
      rewards={[]}
      pulseScore={30}
      state={'buzzing' as NodeState}
      onCheckIn={vi.fn()}
      onSignup={vi.fn()}
    />,
  )
}

describe('PeekCarousel', () => {
  it('renders nothing when the carousel is closed', () => {
    const { container } = renderCarousel({ mode: 'closed' })
    expect(container.querySelector('[data-peek-carousel]')).toBeNull()
  })

  it('announces the Active_Venue name and live count via an aria-live region (Property 14)', () => {
    renderCarousel({ activeVenueVM: vm('a', { name: 'The Blue Room', liveCheckInCount: 7 }) })
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('The Blue Room')
    expect(status.textContent).toContain('7')
  })

  it('cards are selection-only: tapping any card selects it and never enters Commit_Mode', () => {
    const enterCommit = vi.fn()
    const selectVenue = vi.fn()
    const { container } = renderCarousel({ activeVenueId: 'a', enterCommit, selectVenue })

    // Tapping the active card selects (does not open details).
    fireEvent.click(container.querySelector('[data-venue-card="a"]')!)
    expect(selectVenue).toHaveBeenCalledWith('a', 'swipe')

    // Tapping another card selects it.
    fireEvent.click(container.querySelector('[data-venue-card="b"]')!)
    expect(selectVenue).toHaveBeenCalledWith('b', 'swipe')

    // Card taps never enter Commit_Mode.
    expect(enterCommit).not.toHaveBeenCalled()
  })

  it('shows the "Back to recommended" cue only in area scope and calls showRecommended', () => {
    const showRecommended = vi.fn()
    const { container } = renderCarousel({ browseScope: 'area', showRecommended })

    const cue = container.querySelector('[data-back-to-recommended]')
    expect(cue).toBeTruthy()
    fireEvent.click(cue!)
    expect(showRecommended).toHaveBeenCalledTimes(1)
  })

  it('hides the "Back to recommended" cue in recommended scope', () => {
    const { container } = renderCarousel({ browseScope: 'recommended' })
    expect(container.querySelector('[data-back-to-recommended]')).toBeNull()
  })

  it('the "View details" control enters Commit_Mode', () => {
    const enterCommit = vi.fn()
    renderCarousel({ enterCommit })
    fireEvent.click(screen.getByRole('button', { name: /view details/i }))
    expect(enterCommit).toHaveBeenCalledTimes(1)
  })

  it('Commit_Mode renders the detail body and a back control that returns to Browse_Mode', () => {
    const enterBrowse = vi.fn()
    const { container } = renderCarousel({ mode: 'commit', enterBrowse })

    expect(container.querySelector('[data-node-detail-stub]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to browsing' }))
    expect(enterBrowse).toHaveBeenCalledTimes(1)
  })

  it('shows the empty-viewport invite when no venue is in range', () => {
    const { container } = renderCarousel({ carouselOrderVMs: [] })
    expect(container.querySelector('[data-browse-empty]')).toBeTruthy()
  })
})
