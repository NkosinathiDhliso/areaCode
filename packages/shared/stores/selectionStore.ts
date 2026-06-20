import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * Selection_Model store — the single source of truth for the Active_Venue
 * across all Peek_Carousel input methods (Carousel_Swipe, Flick_Controls,
 * marker tap, Search_Sheet, Focus_Signal). Every input writes here; every
 * renderer reads here, which guarantees the "exactly one Active_Venue while
 * open" invariant (Requirement 1.3 / 2.6) and selection coherence
 * (Requirement 3.x).
 *
 * Client-memory only; never persisted.
 *
 * Validates: Requirements 1.3, 2.4, 2.6, 3.1, 3.2, 3.3
 */

/** The source that triggered an Active_Venue selection. */
export type SelectionSource = 'swipe' | 'flick' | 'marker' | 'search' | 'focus'

/** The two open states of Peek_Carousel plus the closed state. */
export type SelectionMode = 'closed' | 'browse' | 'commit'

export interface SelectionState {
  activeVenueId: string | null
  mode: SelectionMode
  carouselOrder: string[]
  openedFromFocus: boolean
  /**
   * The id of the most recently active venue, retained after `dismiss` so the
   * carousel can be re-opened on the last venue without a fresh selection
   * gesture. Cleared only when a new venue is selected (it tracks that venue
   * instead). Null when nothing has been selected yet this session.
   */
  lastVenueId: string | null
  selectVenue: (id: string, source: SelectionSource) => void
  step: (dir: 1 | -1) => void
  enterCommit: () => void
  enterBrowse: () => void
  dismiss: () => void
  /**
   * Re-open the carousel (in Browse_Mode) on the {@link lastVenueId} retained
   * from the previous dismiss. No-op when there is no last venue. The re-open
   * never counts as a Focus_Signal, so `openedFromFocus` is reset to false.
   */
  reopenLast: () => void
  setOrder: (order: string[]) => void
}

/**
 * Steps an index forward or backward in a circular list of `length` items,
 * wrapping at both ends: `(current + dir + length) mod length`.
 *
 * Total and pure: for a list of length <= 1 there is nothing to step to, so
 * `current` is returned unchanged. This mirrors the `stepIndex` helper in
 * `apps/web/src/lib/gestureClassifier.ts`; it is intentionally duplicated
 * here rather than imported so that this shared store does not depend on
 * app-side code (a cross-package import from `apps/web` into
 * `packages/shared` would invert the dependency graph and break the build).
 */
function stepIndex(current: number, dir: 1 | -1, length: number): number {
  if (length <= 1) return current
  return (current + dir + length) % length
}

export const useSelectionStore = create<SelectionState>()(
  immer((set) => ({
    activeVenueId: null,
    mode: 'closed' as SelectionMode,
    carouselOrder: [],
    openedFromFocus: false,
    lastVenueId: null,

    // Sets the Active_Venue from any input source. Opens Peek_Carousel into
    // Browse_Mode when it was closed, and preserves the current open mode
    // (Browse/Commit) otherwise so re-selecting never collapses an expanded
    // sheet. `openedFromFocus` tracks whether the open originated from a
    // Focus_Signal so the lighter backdrop can be applied (Requirement 15.3).
    selectVenue: (id, source) =>
      set((state) => {
        state.activeVenueId = id
        state.lastVenueId = id
        state.openedFromFocus = source === 'focus'
        if (state.mode === 'closed') {
          state.mode = 'browse'
        }
      }),

    // Moves the Active_Venue one position forward (+1) or backward (-1) in
    // the Carousel_Order, wrapping at both ends. No-op when the order is
    // empty or the current Active_Venue is not present in the order.
    step: (dir) =>
      set((state) => {
        const { carouselOrder, activeVenueId } = state
        if (carouselOrder.length === 0) return
        const currentIndex = activeVenueId === null ? -1 : carouselOrder.indexOf(activeVenueId)
        if (currentIndex === -1) return
        const nextIndex = stepIndex(currentIndex, dir, carouselOrder.length)
        const nextId = carouselOrder[nextIndex]
        if (nextId !== undefined) {
          state.activeVenueId = nextId
        }
      }),

    // Browse <-> Commit transitions preserve the Active_Venue (Requirement 2.4).
    enterCommit: () =>
      set((state) => {
        if (state.activeVenueId !== null) {
          state.mode = 'commit'
        }
      }),

    enterBrowse: () =>
      set((state) => {
        if (state.activeVenueId !== null) {
          state.mode = 'browse'
        }
      }),

    // Dismiss clears the Active_Venue and closes the sheet (Requirement 2.6).
    // The dismissed venue is retained in `lastVenueId` so `reopenLast` can
    // surface it again without a fresh selection gesture.
    dismiss: () =>
      set((state) => {
        if (state.activeVenueId !== null) {
          state.lastVenueId = state.activeVenueId
        }
        state.activeVenueId = null
        state.mode = 'closed'
        state.openedFromFocus = false
      }),

    // Re-open the carousel on the last dismissed venue (Browse_Mode). No-op
    // when there is no retained venue or it is already open. Never a
    // Focus_Signal, so the standard (non-focus) backdrop is used.
    reopenLast: () =>
      set((state) => {
        if (state.lastVenueId === null) return
        state.activeVenueId = state.lastVenueId
        state.openedFromFocus = false
        if (state.mode === 'closed') {
          state.mode = 'browse'
        }
      }),

    setOrder: (order) =>
      set((state) => {
        state.carouselOrder = order
      }),
  })),
)
