import {
  useLocationStore,
  useMapStore,
  useSelectionStore,
  type SelectionMode,
  type SelectionSource,
} from '@area-code/shared/stores'
import { useUserStore } from '@area-code/shared/stores/userStore'
import type { MapInstance, Node, NodeCategory } from '@area-code/shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { canRecenter, moveCameraToActive } from '../lib/cameraControl'
import {
  MAP_ARRIVAL_ZOOM,
  MIN_MARKER_ZOOM,
  RECOMMENDED_LIMIT,
  AREA_SCOPE_MIN_MOVE_M,
  AREA_SCOPE_MIN_ZOOM_DELTA,
  toVenueCardVM,
  type VenueCardVM,
} from '../lib/carouselConstants'
import { vibeRank, scopeToViewport, haversineMeters, type ViewportBounds } from '../lib/carouselRanking'

/**
 * Browse scope for the Peek_Carousel strip:
 *   - `recommended`: citywide top venues by `vibeRank` (taste/aliveness first),
 *     independent of the map viewport. The default on open - it leads with the
 *     strongest "why go THERE, right now" magnets across the whole city.
 *   - `area`: venues within the current Map_Canvas bounds (still vibe-ordered).
 *     Entered when the user actively pans/zooms to explore a place, per the
 *     discovery-DNA rule that viewport scoping is allowed for active browsing.
 */
export type BrowseScope = 'recommended' | 'area'

/**
 * `useCarouselSelection` - the selection orchestration hook that binds every
 * Peek-Carousel input method and renderer to the single `selectionStore`
 * source of truth, and keeps the `Carousel_Order`, camera, and Active_Venue
 * coherent.
 *
 * It is deliberately thin over the pure cores it composes:
 *   - `vibeRank` produces the order; scope decides membership (`recommended`
 *     = citywide top-N, `area` = viewport-scoped after a meaningful user pan).
 *   - `moveCameraToActive` issues exactly one camera move per Active_Venue
 *     change, honouring Reduced_Motion.
 *   - `toVenueCardVM` derives the Venue_Card view models the render shells need.
 *
 * Responsibilities (design § "Selection orchestration hook"):
 *   - Recompute `carouselOrder` via `scopeToViewport ∘ vibeRank` on
 *     debounced viewport changes and on store/filter changes (R6.1, R6.2,
 *     R13.1, R13.2).
 *   - Fly the camera to the Active_Venue whenever it changes (R3.6, R6.4,
 *     R15.4 via `moveCameraToActive`).
 *   - Consume and clear the cross-screen Focus_Signal (R15.1, R15.2, R15.5).
 *   - Lock the order while a Carousel_Swipe is in progress so live updates do
 *     not reshuffle the strip mid-gesture (R18.3 / Property 29).
 *   - On a filter change where the Active_Venue no longer matches: reassign the
 *     Active_Venue to the first of the recomputed order, or dismiss when the
 *     recomputed order is empty (R13.3 / Property 12).
 *
 * The hook reads the live map only through the abstracted `MapInstance` held in
 * `mapStore.mapInstance` (`getBounds().toArray()`), so it stays driveable by the
 * in-memory map stub used in tests - no raw Mapbox or WebGL required.
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 6.4, 13.3, 13.4, 13.5, 15.1, 15.2, 15.4, 15.5
 */

/** Default debounce window (ms) for viewport-driven order recomputes. */
const DEFAULT_RECOMPUTE_DEBOUNCE_MS = 150

export interface UseCarouselSelectionParams {
  /** The active `Category_Filter`, or null when no filter is applied. */
  categoryFilter: NodeCategory | null
  /** Whether the Map_Canvas is loaded and interactive. */
  mapReady: boolean
  /**
   * Override for the Reduced_Motion decision. When omitted the hook reads
   * `prefers-reduced-motion: reduce` from the environment. Passing an explicit
   * value keeps the camera behaviour deterministic in tests.
   */
  reducedMotion?: boolean
  /** Debounce window (ms) for viewport-driven recomputes. */
  recomputeDebounceMs?: number
}

export interface UseCarouselSelectionResult {
  /** The single Active_Venue id, or null when the carousel is closed. */
  activeVenueId: string | null
  /** The Active_Venue node resolved from the store, or null. */
  activeVenue: Node | null
  /** The Active_Venue's Venue_Card view model, or null. */
  activeVenueVM: VenueCardVM | null
  /** Current Peek_Carousel mode. */
  mode: SelectionMode
  /** True when the carousel was opened from a Focus_Signal (lighter backdrop). */
  openedFromFocus: boolean
  /** Ordered venue ids for Browse_Mode. */
  carouselOrder: string[]
  /** Venue_Card view models in `carouselOrder` order. */
  carouselOrderVMs: VenueCardVM[]
  /** Set the Active_Venue from a given input source. */
  selectVenue: (id: string, source: SelectionSource) => void
  /** Step the Active_Venue one position in the order (wraps). */
  step: (dir: 1 | -1) => void
  /** Settle a Carousel_Swipe to an adjacent card (steps the order). */
  onSwipe: (dir: 1 | -1) => void
  /** Handle a marker tap: select the venue and surface it in the order. */
  onMarkerTap: (nodeId: string) => void
  /** Handle a Search_Sheet selection: select the venue and surface it. */
  onSearchSelect: (nodeId: string) => void
  /** Enter Commit_Mode for the Active_Venue. */
  enterCommit: () => void
  /** Return to Browse_Mode (preserves Active_Venue). */
  enterBrowse: () => void
  /** Dismiss the carousel, clearing the Active_Venue. */
  dismiss: () => void
  /** The most recently dismissed venue id, retained for re-open. Null if none. */
  lastVenueId: string | null
  /** Re-open the carousel on the last dismissed venue (Browse_Mode). */
  reopenLast: () => void
  /**
   * Mark a Carousel_Swipe as in progress (true) or settled (false). While in
   * progress the order is locked; on settle a deferred recompute is applied.
   */
  setSwipeInProgress: (inProgress: boolean) => void
  /** Recompute the order immediately (bypasses the debounce; respects the swipe lock). */
  recomputeOrder: () => void
  /** Notify the hook that the viewport changed (debounced recompute) - wire to map `moveend`/`zoom`. */
  notifyViewportChanged: () => void
  /**
   * Current browse scope. `recommended` = citywide top venues (default);
   * `area` = venues in the current viewport (after the user pans/zooms).
   */
  browseScope: BrowseScope
  /** Return to the citywide `recommended` scope (the "Back to recommended" cue). */
  showRecommended: () => void
}

/** Reads `prefers-reduced-motion: reduce`, defaulting to false off-DOM. */
function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Read the current viewport as a {@link ViewportBounds} from the abstracted
 * map instance. Returns null when the map is absent, the read throws, or the
 * bounds are not finite - `scopeToViewport` treats null bounds as "viewport
 * unknown" and keeps only the Active_Venue.
 *
 * `MapInstance.getBounds().toArray()` follows the Mapbox convention
 * `[[west, south], [east, north]]` (south-west corner, then north-east).
 */
function readBounds(map: MapInstance | null): ViewportBounds | null {
  if (!map) return null
  try {
    const [[west, south], [east, north]] = map.getBounds().toArray()
    if (![west, south, east, north].every((n) => Number.isFinite(n))) return null
    return { west, east, south, north }
  } catch {
    return null
  }
}

/** Map centre + zoom snapshot used to detect meaningful user exploration. */
interface ViewportSnapshot {
  lat: number
  lng: number
  zoom: number
}

function readViewportSnapshot(map: MapInstance | null): ViewportSnapshot | null {
  if (!map) return null
  try {
    const [[west, south], [east, north]] = map.getBounds().toArray()
    const zoom = map.getZoom()
    if (![west, south, east, north, zoom].every((n) => Number.isFinite(n))) return null
    return { lat: (south + north) / 2, lng: (west + east) / 2, zoom }
  } catch {
    return null
  }
}

function isMeaningfulViewportChange(from: ViewportSnapshot, to: ViewportSnapshot): boolean {
  const movedM = haversineMeters(from, to)
  return movedM >= AREA_SCOPE_MIN_MOVE_M || Math.abs(to.zoom - from.zoom) >= AREA_SCOPE_MIN_ZOOM_DELTA
}

/** Mapbox map instances expose `once`; the abstract {@link MapInstance} does not. */
type MapWithOnce = MapInstance & { once?: (event: string, handler: () => void) => void }

/** Order-equality check to avoid redundant `setOrder` writes (and render churn). */
function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function useCarouselSelection({
  categoryFilter,
  mapReady,
  reducedMotion,
  recomputeDebounceMs = DEFAULT_RECOMPUTE_DEBOUNCE_MS,
}: UseCarouselSelectionParams): UseCarouselSelectionResult {
  // ── Store reads (subscriptions) ───────────────────────────────────────────
  const nodes = useMapStore((s) => s.nodes)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const checkInCounts = useMapStore((s) => s.checkInCounts)
  const archetypeIds = useMapStore((s) => s.archetypeIds)
  const focusNodeId = useMapStore((s) => s.focusNodeId)
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)

  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const capturedAt = useLocationStore((s) => s.capturedAt)

  const activeVenueId = useSelectionStore((s) => s.activeVenueId)
  const mode = useSelectionStore((s) => s.mode)
  const openedFromFocus = useSelectionStore((s) => s.openedFromFocus)
  const carouselOrder = useSelectionStore((s) => s.carouselOrder)
  const lastVenueId = useSelectionStore((s) => s.lastVenueId)
  const selectVenueRaw = useSelectionStore((s) => s.selectVenue)
  const stepRaw = useSelectionStore((s) => s.step)
  const enterCommit = useSelectionStore((s) => s.enterCommit)
  const enterBrowse = useSelectionStore((s) => s.enterBrowse)
  const dismiss = useSelectionStore((s) => s.dismiss)
  const reopenLastRaw = useSelectionStore((s) => s.reopenLast)
  const setOrder = useSelectionStore((s) => s.setOrder)

  const reducedMotionValue = reducedMotion ?? detectReducedMotion()

  // ── Browse scope (recommended citywide vs viewport area) ─────────────────
  //
  // Held in a ref so `computeOrder` always reads the current scope at call time
  // (no stale closure across the debounce), mirrored in state so the render
  // shells can surface the "Back to recommended" cue. The default is
  // `recommended`: the carousel opens on the strongest citywide magnets, and
  // only narrows to the viewport once the user actively pans/zooms.
  const browseScopeRef = useRef<BrowseScope>('recommended')
  const [browseScope, setBrowseScopeState] = useState<BrowseScope>('recommended')
  const setBrowseScope = useCallback((scope: BrowseScope) => {
    browseScopeRef.current = scope
    setBrowseScopeState(scope)
  }, [])

  // Baseline viewport for distinguishing accidental micro-drags from real
  // exploration. Updated on map ready, after programmatic fly-to, and when
  // returning to the recommended scope.
  const lastViewportRef = useRef<ViewportSnapshot | null>(null)
  const snapshotViewport = useCallback(() => {
    const snap = readViewportSnapshot(useMapStore.getState().mapInstance)
    if (snap) lastViewportRef.current = snap
  }, [])

  // ── Order recompute core ────────────────────────────────────────────────
  //
  // Reads live snapshots via `getState()` so the computation always sees the
  // latest store values regardless of render timing. Pure composition of
  // `vibeRank` then `scopeToViewport`; the active id passed to
  // `scopeToViewport` guarantees the Active_Venue is never silently dropped
  // (R6.5) - except when it no longer matches the filter, in which case it is
  // intentionally excluded so the filter-reassignment effect can take over.
  const computeOrder = useCallback((): string[] => {
    const mapState = useMapStore.getState()
    const allNodes = Object.values(mapState.nodes)
    const filtered = categoryFilter ? allNodes.filter((n) => n.category === categoryFilter) : allNodes

    const positionFresh = canRecenter(useLocationStore.getState().capturedAt, Date.now())
    const ranked = vibeRank({
      venues: filtered,
      pulseScores: mapState.pulseScores,
      checkInCounts: mapState.checkInCounts,
      lastKnownPosition: useLocationStore.getState().lastKnownPosition,
      positionFresh,
      // Taste-match and live-gets signals (vibe-ranked-browse R1, R15.3).
      // Read from live snapshots so ranking always sees the latest values.
      consumerArchetypeId: useUserStore.getState().user?.archetypeId ?? null,
      venueArchetypeIds: mapState.archetypeIds,
      friendsAtVenue: mapState.friendsAtVenue,
      hasLiveGets: mapState.hasLiveGets,
    })

    const activeId = useSelectionStore.getState().activeVenueId

    // Area scope: restrict to the current viewport (still vibe-ordered),
    // never dropping the Active_Venue (R6.x). Entered when the user explores.
    if (browseScopeRef.current === 'area') {
      const bounds = readBounds(mapState.mapInstance)
      const scoped = scopeToViewport(ranked, bounds, activeId)
      return scoped.map((n) => n.id)
    }

    // Recommended scope (default): the full citywide vibe-ranked list, capped.
    // Independent of the viewport so the strip leads with the strongest
    // taste/aliveness magnets regardless of where the map currently sits. The
    // Active_Venue is retained even if it ranks past the cap.
    const top = ranked.slice(0, RECOMMENDED_LIMIT)
    if (activeId && !top.some((n) => n.id === activeId)) {
      const active = ranked.find((n) => n.id === activeId)
      if (active) top.push(active)
    }
    return top.map((n) => n.id)
  }, [categoryFilter])

  // Lock flag for an in-progress Carousel_Swipe (R18.3 / Property 29).
  const swipeInProgressRef = useRef(false)

  const recomputeOrder = useCallback(() => {
    if (swipeInProgressRef.current) return // order is locked mid-swipe
    const next = computeOrder()
    if (!sameOrder(useSelectionStore.getState().carouselOrder, next)) {
      setOrder(next)
    }
  }, [computeOrder, setOrder])

  // Debounced recompute used for viewport (`moveend`/`zoom`) and store changes.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRecompute = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      recomputeOrder()
    }, recomputeDebounceMs)
  }, [recomputeOrder, recomputeDebounceMs])

  // Clear any pending debounce on unmount.
  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    },
    [],
  )

  // Recompute (debounced) when the ranking inputs change: venue set, buzz
  // signals, and the Last_Known_Position. Filter changes are handled by the
  // synchronous effect below; viewport changes by `notifyViewportChanged`.
  useEffect(() => {
    if (!mapReady) return
    snapshotViewport()
    debouncedRecompute()
  }, [nodes, pulseScores, checkInCounts, lastKnownPosition, capturedAt, mapReady, debouncedRecompute, snapshotViewport])

  // ── Filter change: recompute synchronously and reassign the Active_Venue ──
  //
  // On a Category_Filter change the order is recomputed immediately (not
  // debounced) so the strip never momentarily shows venues from the previous
  // filter. If the Active_Venue no longer matches the filter it is reassigned
  // to the first of the recomputed order, or the carousel is dismissed when the
  // recomputed order is empty (R13.3 / Property 12).
  useEffect(() => {
    if (!mapReady) return
    const order = computeOrder()
    if (!sameOrder(useSelectionStore.getState().carouselOrder, order)) {
      setOrder(order)
    }

    const activeId = useSelectionStore.getState().activeVenueId
    if (activeId === null) return

    const activeNode = useMapStore.getState().nodes[activeId]
    const matches = !categoryFilter || activeNode?.category === categoryFilter
    if (matches) return

    const firstId = order[0]
    if (firstId === undefined) {
      dismiss()
    } else {
      // Automatic system reassignment (not a user gesture). The source only
      // governs `openedFromFocus`, which must be false here.
      selectVenueRaw(firstId, 'flick')
    }
    // `categoryFilter` drives `computeOrder`'s identity; `mapReady` gates the
    // first run. Other deps are stable store mutators.
  }, [categoryFilter, mapReady, computeOrder, setOrder, selectVenueRaw, dismiss])

  // ── Camera: fly to the Active_Venue on change (exactly one move) ──────────
  const prevActiveRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeVenueId === null) {
      prevActiveRef.current = null
      return
    }
    if (activeVenueId === prevActiveRef.current) return

    const map = useMapStore.getState().mapInstance
    const node = useMapStore.getState().nodes[activeVenueId]
    // Map or node not ready yet (e.g. a cold open while Mapbox is still
    // loading): do NOT advance prevActiveRef, so this effect retries once
    // `mapReady` flips true (it is in the dep array). Advancing the ref here
    // would permanently skip the first fly-to and leave the map parked on the
    // country overview - which also collapses the viewport-scoped carousel
    // order to a single venue, so stepping could never recover (R4.7, R6.1).
    if (!map || !node) {
      return
    }
    prevActiveRef.current = activeVenueId

    // Snap in whenever the map is too far out to show venue markers (below
    // MIN_MARKER_ZOOM). This covers the cold open AND any later selection made
    // while zoomed out to the globe/country overview, so picking a venue (tap
    // or flick arrows) always brings it into view instead of an imperceptible
    // pan. Leads with aliveness, not proximity (discovery-DNA rule). When the
    // user is already zoomed past the marker threshold the move omits zoom and
    // preserves their chosen zoom (browse flow).
    let arrivalZoom: number | undefined
    let currentZoom = MAP_ARRIVAL_ZOOM
    try {
      currentZoom = map.getZoom?.() ?? MAP_ARRIVAL_ZOOM
    } catch {
      /* map read failed - treat as already-zoomed, don't force a zoom */
    }
    if (currentZoom < MIN_MARKER_ZOOM) arrivalZoom = MAP_ARRIVAL_ZOOM

    moveCameraToActive(map, node, {
      reducedMotion: reducedMotionValue,
      ...(arrivalZoom !== undefined ? { zoom: arrivalZoom } : {}),
    })
    // Refresh the exploration baseline after the fly-to settles so a later
    // micro-drag is not measured against the pre-selection viewport.
    ;(map as MapWithOnce).once?.('moveend', snapshotViewport)
  }, [activeVenueId, reducedMotionValue, mapReady, snapshotViewport])

  // ── Focus_Signal consumption ──────────────────────────────────────────────
  //
  // When another surface (e.g. the Gets list) sets `focusNodeId`, select that
  // venue (which flies the camera and surfaces it in the order) and clear the
  // signal so it is not re-applied (R15.2). If the venue is not in the store,
  // clear the signal without opening the carousel and without error (R15.5).
  useEffect(() => {
    if (!focusNodeId || !mapReady) return
    const node = useMapStore.getState().nodes[focusNodeId]
    if (node) {
      selectVenueRaw(focusNodeId, 'focus')
      recomputeOrder()
    }
    setFocusNodeId(null)
  }, [focusNodeId, mapReady, selectVenueRaw, setFocusNodeId, recomputeOrder])

  // ── Input handlers ────────────────────────────────────────────────────────
  const selectVenue = useCallback(
    (id: string, source: SelectionSource) => {
      selectVenueRaw(id, source)
    },
    [selectVenueRaw],
  )

  const step = useCallback(
    (dir: 1 | -1) => {
      stepRaw(dir)
    },
    [stepRaw],
  )

  const onSwipe = useCallback(
    (dir: 1 | -1) => {
      stepRaw(dir)
    },
    [stepRaw],
  )

  const onMarkerTap = useCallback(
    (nodeId: string) => {
      selectVenueRaw(nodeId, 'marker')
      recomputeOrder()
    },
    [selectVenueRaw, recomputeOrder],
  )

  const onSearchSelect = useCallback(
    (nodeId: string) => {
      selectVenueRaw(nodeId, 'search')
      recomputeOrder()
    },
    [selectVenueRaw, recomputeOrder],
  )

  const setSwipeInProgress = useCallback(
    (inProgress: boolean) => {
      swipeInProgressRef.current = inProgress
      if (!inProgress) {
        // Swipe settled - apply any updates that were deferred while locked.
        recomputeOrder()
      }
    },
    [recomputeOrder],
  )

  const notifyViewportChanged = useCallback(() => {
    const map = useMapStore.getState().mapInstance
    let zoom = MAP_ARRIVAL_ZOOM
    try {
      zoom = map?.getZoom() ?? MAP_ARRIVAL_ZOOM
    } catch {
      /* ignore */
    }

    // Constellation zoom: stay citywide recommended; never enter area scope.
    if (zoom < MIN_MARKER_ZOOM) {
      if (browseScopeRef.current === 'area') {
        setBrowseScope('recommended')
        recomputeOrder()
      }
      return
    }

    const current = readViewportSnapshot(map)
    if (!current) return

    const previous = lastViewportRef.current
    lastViewportRef.current = current

    if (browseScopeRef.current === 'recommended') {
      // First event after a baseline snapshot: record only, stay citywide.
      if (previous === null) return
      // Ignore micro-moves and control jitter until the user meaningfully
      // explores a new part of the map.
      if (!isMeaningfulViewportChange(previous, current)) return
      setBrowseScope('area')
    }

    debouncedRecompute()
  }, [setBrowseScope, debouncedRecompute, recomputeOrder])

  // Return to the citywide recommended scope (the "Back to recommended" cue).
  const showRecommended = useCallback(() => {
    setBrowseScope('recommended')
    snapshotViewport()
    recomputeOrder()
  }, [setBrowseScope, snapshotViewport, recomputeOrder])

  // Reset to the recommended scope whenever the carousel closes, so each fresh
  // open leads with the citywide recommendations rather than a stale area view.
  // Recompute while closed (Active_Venue is null) so the next open is correct.
  useEffect(() => {
    if (mode !== 'closed') return
    setBrowseScope('recommended')
    snapshotViewport()
    recomputeOrder()
  }, [mode, setBrowseScope, snapshotViewport, recomputeOrder])

  // Re-open the carousel on the last dismissed venue and ensure it is present
  // in the recomputed order so Browse_Mode surfaces it immediately.
  const reopenLast = useCallback(() => {
    reopenLastRaw()
    recomputeOrder()
  }, [reopenLastRaw, recomputeOrder])

  // ── Derived view models ─────────────────────────────────────────────────
  const carouselOrderVMs = useMemo<VenueCardVM[]>(() => {
    return carouselOrder
      .map((id) => nodes[id])
      .filter((n): n is Node => n !== undefined)
      .map((n) => toVenueCardVM(n, checkInCounts, pulseScores, archetypeIds))
  }, [carouselOrder, nodes, checkInCounts, pulseScores, archetypeIds])

  const activeVenue = activeVenueId ? (nodes[activeVenueId] ?? null) : null
  const activeVenueVM = useMemo<VenueCardVM | null>(
    () => (activeVenue ? toVenueCardVM(activeVenue, checkInCounts, pulseScores, archetypeIds) : null),
    [activeVenue, checkInCounts, pulseScores, archetypeIds],
  )

  return {
    activeVenueId,
    activeVenue,
    activeVenueVM,
    mode,
    openedFromFocus,
    carouselOrder,
    carouselOrderVMs,
    selectVenue,
    step,
    onSwipe,
    onMarkerTap,
    onSearchSelect,
    enterCommit,
    enterBrowse,
    dismiss,
    lastVenueId,
    reopenLast,
    setSwipeInProgress,
    recomputeOrder,
    notifyViewportChanged,
    browseScope,
    showRecommended,
  }
}
