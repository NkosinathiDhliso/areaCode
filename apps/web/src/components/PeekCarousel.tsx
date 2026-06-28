import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { NodeCategory, NodeState, Reward } from '@area-code/shared/types'
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { useEffect, useReducer, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { UseCarouselSelectionResult } from '../hooks/useCarouselSelection'
import { DRAG_AXIS_THRESHOLD } from '../lib/carouselConstants'
import { browseReducer, deriveBrowseStrip } from '../lib/carouselRanking'
import { classifyDrag } from '../lib/gestureClassifier'

import { FlickControls } from './FlickControls'
import { NodeDetailContent } from './NodeDetailContent'
import { VenueCard } from './VenueCard'

/**
 * `PeekCarousel` - the two-state browse-and-compare host for the consumer map.
 *
 * It layers exactly two states on a single shared {@link BottomSheet}
 * (Requirement 2.1, 2.5):
 *   - **Browse_Mode** (collapsed): a horizontally swipeable strip of
 *     {@link VenueCard}s plus the keyboard-/screen-reader-operable
 *     {@link FlickControls}. The active card drives the Map_Canvas `flyTo`
 *     (handled by `useCarouselSelection`).
 *   - **Commit_Mode** (expanded): the full {@link NodeDetailContent} body
 *     (rewards, archetype glyph + name, crowd vibe, directions, check-in CTA)
 *     for the Active_Venue.
 *
 * Switching between the two is a height/state change on the *same* sheet - the
 * detail body is rendered inline rather than as a separate detail surface
 * (Requirement 2.5).
 *
 * Gesture arbitration is delegated to the pure {@link classifyDrag} core
 * (Requirement 7): a predominantly horizontal drag is a Carousel_Swipe and
 * never dismisses the sheet (R7.1); a predominantly vertical drag is a
 * mode-change/dismiss and never advances the carousel (R7.2); a horizontal drag
 * that begins on the rewards row routes to native scroll and changes nothing
 * (R7.3); an indeterminate drag takes no action (R7.5).
 *
 * The component is a thin shell over the {@link UseCarouselSelectionResult}
 * passed by `MapScreen` (task 17.1); it owns no selection state of its own.
 *
 * Feature: map-discovery-experience
 * Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 4.2, 4.3, 6.3, 7.1, 7.2, 7.3, 8.3, 8.4
 */
export interface PeekCarouselProps {
  /**
   * The selection orchestration result from `useCarouselSelection`, owned by
   * `MapScreen`. Provides the Active_Venue, the Carousel_Order view models, the
   * current mode, and every selection/mode mutator the carousel drives.
   */
  selection: UseCarouselSelectionResult
  /** Rewards for the Active_Venue (Commit_Mode body); empty when none/loading. */
  rewards: Reward[]
  /** The Active_Venue's Pulse_Score. */
  pulseScore: number
  /** The Active_Venue's Pulse_State, derived from {@link pulseScore}. */
  state: NodeState
  /** Perform a check-in for the Active_Venue (wired from `useCheckInFlow`). */
  onCheckIn: () => void
  /** Open the Signup_Surface (email/password + Google OAuth only). */
  onSignup: () => void
  /** GPS-too-far flag - drives the CTA into its QR-fallback label. */
  qrFallback?: boolean
  /** Whether a check-in request is in flight (CTA pending state). */
  isCheckingIn?: boolean
  /**
   * The active Category_Filter - passed so the browse strip state machine can
   * dispatch `FILTER_CHANGE` when it changes, resetting to top 2 view (R4.4).
   */
  categoryFilter?: NodeCategory | null
}

/** Visually-hidden style for the aria-live announcer (portable `sr-only`). */
const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

export function PeekCarousel({
  selection,
  rewards,
  pulseScore,
  state,
  onCheckIn,
  onSignup,
  qrFallback = false,
  isCheckingIn = false,
  categoryFilter = null,
}: PeekCarouselProps) {
  const { t } = useTranslation()
  const nodes = useMapStore((s) => s.nodes)

  const {
    mode,
    activeVenueId,
    activeVenue,
    activeVenueVM,
    carouselOrderVMs,
    openedFromFocus,
    onSwipe,
    selectVenue,
    enterCommit,
    enterBrowse,
    dismiss,
    setSwipeInProgress,
  } = selection

  // ── Browse strip expansion state (Top 2 + More) ──────────────────────────
  // Managed via the pure `browseReducer` from carouselRanking.ts. The reducer
  // resets to collapsed (top 2) on OPEN, FILTER_CHANGE, and DISMISS, and
  // expands on TAP_MORE (R4.3, R4.4).
  const [browseState, browseDispatch] = useReducer(browseReducer, { isExpanded: false })

  // Dispatch OPEN when the carousel transitions from closed to browse/commit,
  // and DISMISS when it transitions to closed (R4.4).
  const prevModeRef = useRef(mode)
  useEffect(() => {
    const prevMode = prevModeRef.current
    prevModeRef.current = mode
    if (prevMode === 'closed' && mode !== 'closed') {
      browseDispatch({ type: 'OPEN' })
    } else if (prevMode !== 'closed' && mode === 'closed') {
      browseDispatch({ type: 'DISMISS' })
    }
  }, [mode])

  // Dispatch FILTER_CHANGE when the categoryFilter changes.
  const prevFilterRef = useRef(categoryFilter)
  useEffect(() => {
    if (prevFilterRef.current !== categoryFilter) {
      prevFilterRef.current = categoryFilter
      browseDispatch({ type: 'FILTER_CHANGE' })
    }
  }, [categoryFilter])

  // Derive visible venues and "showMore" from the full carousel order and the
  // expansion state. The selector is pure and property-tested (Property 6).
  // We resolve the full Node[] from the VMs' ids to pass to deriveBrowseStrip,
  // then map back to VMs for rendering.
  const { visibleVMs, showMore } = (() => {
    const allNodes = carouselOrderVMs
      .map((vm) => nodes[vm.id])
      .filter((n): n is NonNullable<typeof n> => n !== undefined)
    const { visible, showMore } = deriveBrowseStrip(allNodes, browseState.isExpanded)
    const visibleIds = new Set(visible.map((n) => n.id))
    return {
      visibleVMs: carouselOrderVMs.filter((vm) => visibleIds.has(vm.id)),
      showMore,
    }
  })()

  // ── Gesture state ─────────────────────────────────────────────────────────
  // Pointer-down origin plus whether the gesture began on the rewards row, so
  // the dominant-axis decision (delegated to `classifyDrag`) can be applied on
  // pointer-up and a rewards-row horizontal drag can be routed to native scroll.
  const dragStartRef = useRef<{ x: number; y: number; inRewards: boolean } | null>(null)

  const handlePointerDown = (e: ReactPointerEvent) => {
    const target = e.target
    const inRewards = target instanceof Element && target.closest('[data-rewards-row]') !== null
    dragStartRef.current = { x: e.clientX, y: e.clientY, inRewards }
    // Lock the Browse_Mode order while a swipe is in progress (R18.3 / Property
    // 29) so live updates do not reshuffle the strip mid-gesture.
    if (mode === 'browse') setSwipeInProgress(true)
  }

  const handlePointerEnd = (e: ReactPointerEvent) => {
    const start = dragStartRef.current
    dragStartRef.current = null
    if (mode === 'browse') setSwipeInProgress(false)
    if (!start) return

    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const axis = classifyDrag(dx, dy, DRAG_AXIS_THRESHOLD)

    // R7.5: an indeterminate gesture (e.g. a tap, or a diagonal under the
    // threshold) takes no selection or state-change action - the underlying
    // button's click still fires for taps.
    if (axis === 'indeterminate') return

    if (mode === 'commit') {
      // R7.3: a horizontal drag that began on the rewards row is native scroll
      // only - never a selection or state change.
      if (start.inRewards) return
      // A downward drag collapses Commit_Mode back to Browse_Mode, preserving
      // the Active_Venue (R2.4). There is no inter-venue swipe in Commit_Mode.
      if (axis === 'vertical' && dy > 0) enterBrowse()
      return
    }

    // Browse_Mode.
    if (axis === 'horizontal') {
      // R7.1: horizontal → Carousel_Swipe; never dismiss. Swiping left (dx < 0)
      // advances to the next card; swiping right steps to the previous.
      onSwipe(dx < 0 ? 1 : -1)
    } else {
      // R7.2: vertical → mode change/dismiss; never advance the carousel. Up
      // expands to Commit_Mode (R2.2); down dismisses (R2.6).
      if (dy < 0) enterCommit()
      else dismiss()
    }
  }

  if (mode === 'closed') return null

  // The aria-live announcement of the Active_Venue (R8.3 / Property 14). It is
  // always present in the DOM so assistive tech reads the name and the live
  // count whenever the Active_Venue changes.
  const announcement = activeVenueVM
    ? `${activeVenueVM.name}, ${
        activeVenueVM.isFirstIn
          ? t('venueCard.beFirst', 'Be the first in')
          : `${activeVenueVM.liveCheckInCount} ${t('venueCard.hereNow', 'here now')}`
      }`
    : ''

  return (
    <BottomSheet isOpen onClose={dismiss} transparentBackdrop={openedFromFocus}>
      <div
        data-peek-carousel
        data-mode={mode}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={() => {
          dragStartRef.current = null
          if (mode === 'browse') setSwipeInProgress(false)
        }}
      >
        {/* Active_Venue announcer for assistive technology (R8.3 / Property 14). */}
        <div role="status" aria-live="polite" style={SR_ONLY}>
          {announcement}
        </div>

        {mode === 'browse' ? (
          <BrowseMode
            carouselOrderVMs={visibleVMs}
            activeVenueId={activeVenueId}
            showMore={showMore}
            nodeCategoryOf={(id) => nodes[id]?.category ?? null}
            onCardSelect={(id) => {
              // Cards are selection-only: tapping any card sets the Active_Venue
              // (which flies the camera to it). Details/Commit_Mode open only via
              // the dedicated "View details" control, never from a card tap.
              selectVenue(id, 'swipe')
            }}
            onTapMore={() => browseDispatch({ type: 'TAP_MORE' })}
            onEnterCommit={enterCommit}
          />
        ) : (
          <CommitMode onBackToBrowse={enterBrowse} backLabel={t('map.backToBrowse', 'Back to browsing')}>
            <NodeDetailContent
              node={activeVenue}
              rewards={rewards}
              pulseScore={pulseScore}
              state={state}
              onCheckIn={onCheckIn}
              onSignup={onSignup}
              qrFallback={qrFallback}
              isCheckingIn={isCheckingIn}
            />
          </CommitMode>
        )}
      </div>
    </BottomSheet>
  )
}

// ─── Browse_Mode ─────────────────────────────────────────────────────────────

interface BrowseModeProps {
  carouselOrderVMs: UseCarouselSelectionResult['carouselOrderVMs']
  activeVenueId: string | null
  /** Whether to render the "Keep exploring" card after the venue cards (R4.2). */
  showMore: boolean
  nodeCategoryOf: (id: string) => NodeCategory | null
  onCardSelect: (id: string) => void
  /** Callback when the "Keep exploring" card is activated (R4.3). */
  onTapMore: () => void
  onEnterCommit: () => void
}

function BrowseMode({
  carouselOrderVMs,
  activeVenueId,
  showMore,
  nodeCategoryOf,
  onCardSelect,
  onTapMore,
  onEnterCommit,
}: BrowseModeProps) {
  const { t } = useTranslation()
  // Empty Browse_Mode invite when no venue falls within the current viewport
  // (R6.3) - invite the consumer to zoom out or move the map.
  if (carouselOrderVMs.length === 0) {
    return (
      <div data-browse-empty className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-[var(--text-primary)] text-sm font-semibold">
          {t('map.browseEmptyTitle', 'No venues in view')}
        </p>
        <p className="text-[var(--text-secondary)] text-xs max-w-[260px]">
          {t('map.browseEmptyHint', 'Zoom out or move the map to find venues near you.')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Swipeable Venue_Card strip (R1.1). Horizontal overflow scrolls so all
          in-viewport cards are reachable; selection is driven by tap, swipe,
          and the FlickControls below. In collapsed (top 2) view, a "Keep
          exploring" card follows the venue cards as the third element (R4.2). */}
      <div className="flex flex-row gap-3 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {carouselOrderVMs.map((vm) => {
          const category = nodeCategoryOf(vm.id)
          if (!category) return null
          return (
            <div key={vm.id} className="shrink-0 w-[200px]">
              <VenueCard
                vm={vm}
                category={category}
                isActive={vm.id === activeVenueId}
                onSelect={() => onCardSelect(vm.id)}
              />
            </div>
          )
        })}
        {/* "Keep exploring" card - shown only in the collapsed top 2 view when
            3+ venues are available. Keyboard-operable (focusable, Enter/Space
            activates) and carries an accessible label (R4.6). Tapping expands
            to the full ranked list (R4.3). */}
        {showMore && (
          <div key="keep-exploring" className="shrink-0 w-[200px]">
            <button
              type="button"
              data-keep-exploring
              onClick={onTapMore}
              aria-label={t('map.keepExploringLabel', 'Keep exploring — show all venues')}
              className="glass-raised flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-3 w-full h-full min-h-[80px] text-center border-2 border-dashed border-[var(--accent)] transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] hover:bg-[var(--accent)]/10"
            >
              <Sparkles size={20} className="text-[var(--accent)]" strokeWidth={1.75} />
              <span className="text-[var(--accent)] text-xs font-semibold">
                {t('map.keepExploring', 'Keep exploring')}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Keyboard-/screen-reader-operable stepping (R8.1, R8.2, R8.6). */}
      <FlickControls disabled={carouselOrderVMs.length <= 1} />

      {/* Keyboard-/screen-reader-operable control to enter Commit_Mode for the
          Active_Venue (R8.4). */}
      <button
        type="button"
        onClick={onEnterCommit}
        disabled={activeVenueId === null}
        className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm transition-all duration-150 active:scale-95 disabled:opacity-40"
      >
        <ChevronUp size={16} strokeWidth={2} />
        {t('map.viewDetails', 'View details')}
      </button>
    </div>
  )
}

// ─── Commit_Mode ─────────────────────────────────────────────────────────────

interface CommitModeProps {
  onBackToBrowse: () => void
  backLabel: string
  children: React.ReactNode
}

function CommitMode({ onBackToBrowse, backLabel, children }: CommitModeProps) {
  return (
    <div className="flex flex-col">
      {/* Keyboard-/screen-reader-operable control to return to Browse_Mode
          (R8.4), preserving the Active_Venue (R2.4). */}
      <button
        type="button"
        onClick={onBackToBrowse}
        aria-label={backLabel}
        title={backLabel}
        className="self-start mb-2 flex items-center gap-1 text-[var(--text-secondary)] text-xs font-medium transition-colors hover:text-[var(--text-primary)]"
      >
        <ChevronDown size={16} strokeWidth={2} />
        {backLabel}
      </button>
      {children}
    </div>
  )
}
