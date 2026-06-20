import { beforeEach, describe, expect, it } from 'vitest'

import { useSelectionStore } from '../selectionStore'
import { useToastStore } from '../toastStore'

/**
 * Map Discovery — Selection_Model / Toast_System decoupling (deferred task 5.4).
 *
 *   - Property 26: Selection changes never enqueue a Check_In_Toast
 *
 * The Selection_Model and the Toast_System are independent stores. Browsing,
 * stepping, committing, and dismissing the Active_Venue must never produce a
 * toast — a Check_In_Toast is only ever admitted through an explicit
 * `addToast({ type: 'checkin' })`. This guards the decoupling against a future
 * regression that wires selection into the toast queue.
 *
 * Validates: Requirements 4.4, 16.2, 16.7
 */

function resetSelection(): void {
  useSelectionStore.setState({
    activeVenueId: null,
    mode: 'closed',
    carouselOrder: [],
    openedFromFocus: false,
    lastVenueId: null,
  })
}

function resetToast(): void {
  useToastStore.setState({ queue: [], isBottomSheetOpen: false, checkInToastSeenAt: {} })
}

describe('Feature: map-discovery-experience, Property 26: Selection changes never enqueue a Check_In_Toast', () => {
  beforeEach(() => {
    resetSelection()
    resetToast()
  })

  it('produces no toast across a full browse / commit / step / dismiss sequence', () => {
    const s = useSelectionStore.getState()
    s.setOrder(['a', 'b', 'c'])
    s.selectVenue('a', 'marker')
    s.step(1)
    s.enterCommit()
    s.enterBrowse()
    s.step(-1)
    s.selectVenue('b', 'swipe')
    s.dismiss()
    s.reopenLast()
    s.step(1)

    expect(useToastStore.getState().queue).toEqual([])
  })

  it('does not touch the Check_In_Toast dedup ledger on selection', () => {
    const s = useSelectionStore.getState()
    s.setOrder(['a', 'b'])
    s.selectVenue('a', 'flick')
    s.step(1)
    s.dismiss()

    expect(useToastStore.getState().checkInToastSeenAt).toEqual({})
  })
})
