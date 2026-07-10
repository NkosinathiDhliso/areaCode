import { useGeolocation, useNodeArchetype, useCityPulseToast, useCheckOut } from '@area-code/shared/hooks'
import { api } from '@area-code/shared/lib/api'
import { useLiveVibeOnMap } from '@area-code/shared/lib/featureGating'
import { haptic } from '@area-code/shared/lib/haptics'
import { trackEvent } from '@area-code/shared/lib/usageEvents'
import {
  useMapStore,
  useConsumerAuthStore,
  useLocationStore,
  useUserStore,
  useSelectionStore,
  usePresenceStore,
} from '@area-code/shared/stores'
import type { Node, NodeCategory, Reward } from '@area-code/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPinOff, Search } from 'lucide-react'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryFilterBar } from '../components/CategoryFilterBar'
import { CheckInCelebration } from '../components/CheckInCelebration'
import { MapControls } from '../components/MapControls'
import { NotificationPrimingSheet, isDeferredRecently } from '../components/NotificationPrimingSheet'
import { PeekCarousel } from '../components/PeekCarousel'
import { ProximityNudgeBanner } from '../components/ProximityNudgeBanner'
import { QrScannerSheet } from '../components/QrScannerSheet'
import { SearchSheet, type SearchResult } from '../components/SearchSheet'
import { SignInSheet } from '../components/SignInSheet'
import { ToastOverlay } from '../components/ToastOverlay'
import { WhisperChip } from '../components/WhisperChip'
import { useCarouselSelection } from '../hooks/useCarouselSelection'
import { useCheckInFlow } from '../hooks/useCheckInFlow'
import { useConstellationSweep } from '../hooks/useConstellationSweep'
import { useHasLiveGets } from '../hooks/useHasLiveGets'
import { useMapInit } from '../hooks/useMapInit'
import { useMapMarkers } from '../hooks/useMapMarkers'
import { useMapSockets } from '../hooks/useMapSockets'
import { useOverlayCoordinator } from '../hooks/useOverlayCoordinator'
import { usePresenceSeeding } from '../hooks/usePresenceSeeding'
import { USER_VIEW_ZOOM } from '../lib/cameraControl'
import { cameraMotion } from '../lib/cameraEasing'
import { MIN_MARKER_ZOOM, SPOTLIGHT_EXIT_ZOOM_DELTA, shouldExitSpotlight } from '../lib/carouselConstants'
import { getNodeState } from '../lib/mapHelpers'
import type { AppRoute } from '../types'

interface MapScreenProps {
  onNavigate: (route: AppRoute) => void
  /**
   * Whether the Map tab is the active route. The map is kept mounted (only
   * hidden with `display:none`) on tab switch so Mapbox is never torn down, but
   * the Peek_Carousel renders through a `document.body` portal and so escapes
   * that hiding. Gate the carousel on this flag so it never leaks on top of
   * other tabs (Ranks, Feed, Profile).
   */
  active: boolean
}

/**
 * Stable empty-nodes reference for presence seeding while the city nodes query
 * is still loading. Using a module-level constant (rather than a fresh `[]`
 * literal each render) keeps `usePresenceSeeding`'s effect from re-firing on
 * every render before the payload resolves.
 */
const EMPTY_NODES: Node[] = []

/**
 * Flag-gated subscriber for live archetype deltas (R11.1, R12.4, R12.6).
 *
 * Mounted only when `live_vibe_on_map` is true; unmounting it tears down the
 * `node:archetype_change` listener and the per-node retention timers, so the
 * subscription is a true no-op while the flag is `false`. Keeps the hook
 * call itself unconditional inside this component to honour React's rules
 * of hooks.
 */
function LiveArchetypeSubscriber({ token, citySlug }: { token: string | undefined; citySlug: string }) {
  useNodeArchetype(token, { citySlug })
  return null
}

/**
 * Mount for the once-per-session City_Pulse toast (R2).
 *
 * The legacy permanent glass card has been removed entirely; the toast is
 * the only surface for the City_Pulse readout on the map tab. Unmounting
 * tears down the grace and auto-dismiss timers via `useCityPulseToast`'s
 * cleanup effect.
 */
function CityPulseToastMount({ mapReady }: { mapReady: boolean }) {
  useCityPulseToast({ mapReady })
  return null
}

export function MapScreen({ onNavigate, active }: MapScreenProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const {
    containerRef,
    mapRef,
    mapReady,
    mapError,
    retryMap,
    is3D,
    setPitch3D,
    bearing,
    resetNorth,
    recenterUser,
    pauseIdleDrift,
  } = useMapInit()

  const setNodes = useMapStore((s) => s.setNodes)
  const addNode = useMapStore((s) => s.addNode)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const focusNodeId = useMapStore((s) => s.focusNodeId)
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const userId = useConsumerAuthStore((s) => s.userId)
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const lastKnownPositionCapturedAt = useLocationStore((s) => s.capturedAt)
  const onboarding = useUserStore((s) => s.onboarding)
  const markHintSeen = useUserStore((s) => s.markHintSeen)
  const { requestLocation } = useGeolocation()

  const citySlug = useUserStore((s) => s.user?.citySlug) ?? 'johannesburg'

  const [searchOpen, setSearchOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<NodeCategory | null>(null)
  const [locationBannerDismissed, setLocationBannerDismissed] = useState(false)
  // Session flags that gate the Notification_Priming_Sheet (R14.7, R17.5). The
  // overlay coordinator turns these into the actual render decision.
  const [hasCompletedFirstCheckIn, setHasCompletedFirstCheckIn] = useState(false)
  const [primingShownThisSession, setPrimingShownThisSession] = useState(false)
  // The check-in reward moment (peak-end). Set on a successful check-in with
  // the honest, client-known values; cleared when the moment self-dismisses.
  const [celebration, setCelebration] = useState<{
    venueName: string
    fromCount: number
    toCount: number
    totalCheckIns: number
    streakCount: number
  } | null>(null)

  // ── Selection_Model: the single source of truth for the Active_Venue ──
  // Drives the Peek_Carousel, the camera, and the marker layer. Replaces the
  // legacy ad-hoc selectedNode/sheetOpen/handleFlick state.
  const selection = useCarouselSelection({ categoryFilter, mapReady })
  const {
    activeVenueId,
    notifyViewportChanged,
    carouselOrder,
    onMarkerTap,
    onSearchSelect,
    dismiss,
    mode: carouselMode,
    commitZoom,
    enterSpotlight,
    exitSpotlight,
    spotlightVenueId,
  } = selection

  const { brushedNodeId, whisperText } = useConstellationSweep(mapRef, mapReady)

  // Check-in funnel: the Commit_Mode check-in CTA becomes visible when the
  // carousel enters `commit`. Fire once per transition into Commit_Mode
  // (audit-gap-closure R4.1). Beacon gates on consent (R4.2).
  const prevCarouselModeRef = useRef(carouselMode)
  useEffect(() => {
    const prev = prevCarouselModeRef.current
    prevCarouselModeRef.current = carouselMode
    if (prev !== 'commit' && carouselMode === 'commit') {
      trackEvent('checkin_cta_shown')
    }
  }, [carouselMode])

  const handleCommitZoom = useCallback(
    (node: Node) => {
      if (useSelectionStore.getState().activeVenueId !== node.id) {
        onMarkerTap(node.id)
      }
      commitZoom()
    },
    [onMarkerTap, commitZoom],
  )

  // Glyph long-press → Spotlight_Mode. Read live zoom from the map at fire time
  // so the gate reflects the current tier, not a stale render value. Spotlight
  // is a dot/glyph-tier affordance only; at Constellation zoom the long-press
  // does nothing (R2.4, R8.1).
  const handleGlyphLongPress = useCallback(
    (node: Node) => {
      let zoom = 0
      try {
        zoom = mapRef.current?.getZoom() ?? 0
      } catch {
        return
      }
      if (zoom < MIN_MARKER_ZOOM) return
      enterSpotlight(node.id)
      haptic(8)
    },
    [mapRef, enterSpotlight],
  )

  // Entry-zoom capture for the zoom-out exit predicate (R7.1). The store stays
  // map-free (D11); the map read belongs to this screen, which owns the map
  // instance. On the null-to-id transition record the live zoom; the zoom-out
  // exit effect (task 7.3) reads this ref. Clear it on exit.
  const spotlightEntryZoomRef = useRef<number | null>(null)
  const prevSpotlightRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevSpotlightRef.current
    prevSpotlightRef.current = spotlightVenueId
    if (prev === null && spotlightVenueId !== null) {
      try {
        spotlightEntryZoomRef.current = mapRef.current?.getZoom() ?? null
      } catch {
        spotlightEntryZoomRef.current = null
      }
    } else if (spotlightVenueId === null) {
      spotlightEntryZoomRef.current = null
    }
  }, [spotlightVenueId, mapRef])

  // ── Zoom-out exit (R7.1, R7.2, R8.1) ──
  // While spotlit, a user zoom-out past SPOTLIGHT_EXIT_ZOOM_DELTA below the
  // entry zoom (or below MIN_MARKER_ZOOM into Constellation) releases the
  // spotlight. Evaluate only user-gesture zoom events: the entry fly-through
  // arc dips zoom by FLY_THROUGH_ZOOM_DIP (2.2), which exceeds the 1.5 exit
  // delta, so scoring programmatic frames would false-exit during the spotlight
  // fly-to (design D7). Mirror the existing moveend originalEvent guard.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || spotlightVenueId === null) return
    const handler = (e: object) => {
      if (!(e as { originalEvent?: unknown }).originalEvent) return
      const entryZoom = spotlightEntryZoomRef.current
      if (entryZoom === null) return
      let currentZoom = entryZoom
      try {
        currentZoom = map.getZoom()
      } catch {
        return
      }
      if (shouldExitSpotlight(entryZoom, currentZoom, SPOTLIGHT_EXIT_ZOOM_DELTA)) {
        exitSpotlight()
      }
    }
    // Re-baseline the entry zoom when a programmatic zoom settles (no
    // originalEvent): the card-hold dive flies to SPOTLIGHT_DIVE_ZOOM after
    // entry, and measuring the exit delta from the pre-dive zoom would demand
    // a 4+ level zoom-out to release. After the settle, "zoom out 1.5 from
    // where the dive left you" holds for every enter path.
    const settleHandler = (e: object) => {
      if ((e as { originalEvent?: unknown }).originalEvent) return
      if (spotlightEntryZoomRef.current === null) return
      try {
        spotlightEntryZoomRef.current = map.getZoom()
      } catch {
        /* map torn down */
      }
    }
    map.on('zoom', handler)
    map.on('zoomend', settleHandler)
    return () => {
      try {
        map.off('zoom', handler)
        map.off('zoomend', settleHandler)
      } catch {
        /* map torn down */
      }
    }
  }, [mapRef, mapReady, spotlightVenueId, exitSpotlight])

  // Socket subscriptions, citySlug passed for anonymous room join
  useMapSockets(citySlug, accessToken ?? undefined, userId)

  // Populate the live-gets ranking signal from rewards-near-me (R5.1, R15.2).
  // Shares the near-me query cache so this adds no extra network call.
  useHasLiveGets()

  // Live archetype delivery is gated by the `live_vibe_on_map` flag (R12.4,
  // R12.6). When the flag is `false` the subscriber is unmounted and the
  // `node:archetype_change` listener is never attached, so the subscription
  // is a true no-op. The flag is read at the top level here so the
  // mount/unmount transition does not violate React's rules of hooks.
  const liveVibeOnMap = useLiveVibeOnMap()

  // Fetch nodes for city
  const {
    data: nodeList,
    isError: nodesError,
    isLoading: nodesLoading,
    refetch: refetchNodes,
  } = useQuery({
    queryKey: ['nodes', citySlug],
    queryFn: () => api.get<Node[]>(`/v1/nodes/${citySlug}`),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (nodeList) {
      setNodes(nodeList)
    }
  }, [nodeList, setNodes])

  // First-paint presence seeding (R4.1, R4.2): once the city nodes resolve,
  // prime each in-view venue's honest Live_Presence_Count over REST so venues
  // do not read quiet before the first `node:presence_update` socket event.
  // One-shot per nodes payload and non-blocking (a `useEffect` fan-out), so it
  // never delays the map render.
  usePresenceSeeding(nodeList ?? EMPTY_NODES)

  // Geolocation acquisition via the GPS state machine hook. We acquire the
  // position (for check-in proximity and to enable the Recenter button) but
  // deliberately do NOT move the camera - the map opens on the full-country
  // overview and only flies to the user when they tap Recenter (USER_VIEW_ZOOM).
  useEffect(() => {
    void requestLocation()
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Commit-mode check-in flow ──
  // Owns the CTA orchestration: signup (email/password + Google OAuth only),
  // GPS-too-far QR fallback, offline fail-safe, and duplicate-submission
  // prevention. The success callback owns the side effects only the screen can
  // perform: closing the carousel, query invalidation, and first-check-in
  // notification priming (R14.7).
  const handleCheckInSuccess = useCallback(
    (nodeId: string) => {
      // Check-in funnel completion, and the terminal step of the Constellation
      // Funnel ship gate (beam_tap -> zoom_commit -> checkin_completed). This is
      // the one check-in success side-effect home (audit-gap-closure R4.1). No
      // venue id is sent (POPIA, R4.3).
      trackEvent('checkin_completed')

      // Establish client-side Active_Presence so the venue surface shows the
      // Check_Out_CTA (honest-presence-ui R3.1). Only set on a real success.
      usePresenceStore.getState().setPresent(nodeId)

      // Optimistic, honest live-count bump. The user genuinely just checked in
      // (GPS/QR proven), so their own arrival is real presence, not a fabricated
      // number (honest-presence.md). The next `node:presence_update` reconciles
      // to the server truth.
      const mapState = useMapStore.getState()
      const fromCount = mapState.checkInCounts[nodeId] ?? 0
      const toCount = fromCount + 1
      mapState.setLivePresenceCount(nodeId, toCount)

      // Optimistic profile progress so the reward moment reflects the new total
      // instantly; the query invalidations below reconcile with the server.
      const userState = useUserStore.getState()
      userState.incrementCheckIns()

      setCelebration({
        venueName: mapState.nodes[nodeId]?.name ?? '',
        fromCount,
        toCount,
        totalCheckIns: useUserStore.getState().totalCheckIns,
        streakCount: userState.streakCount,
      })

      dismiss()
      // Reconcile server truth for the map and the profile progress surfaces
      // (total check-ins, streak, tier progress) the celebration previews.
      void queryClient.invalidateQueries({ queryKey: ['nodes'] })
      void queryClient.invalidateQueries({ queryKey: ['user', 'me'] })
      void queryClient.invalidateQueries({ queryKey: ['streak'] })
      void queryClient.invalidateQueries({ queryKey: ['tier-progress'] })
      if (!onboarding.firstCheckIn) {
        markHintSeen('firstCheckIn')
        setHasCompletedFirstCheckIn(true)
      }
    },
    [dismiss, queryClient, onboarding.firstCheckIn, markHintSeen],
  )

  const checkInFlow = useCheckInFlow({ onCheckInSuccess: handleCheckInSuccess })

  // Commit-mode check-out (honest-presence-ui task 3.2). Symmetric with the
  // check-in wiring: the shared `useCheckOut` hook calls `POST /v1/check-out`
  // and clears Active_Presence on success/no-op. The CTA only shows while the
  // user holds Active_Presence for the Active_Venue.
  const { checkOut, isPending: isCheckingOut } = useCheckOut()
  const handleCheckOut = useCallback(() => {
    if (activeVenueId) void checkOut(activeVenueId)
  }, [activeVenueId, checkOut])

  // ── Marker layer ──
  // The Active_Venue from the Selection_Model carries the active-marker
  // distinction (R12.6); marker taps route through the selection hook so all
  // input methods feed one model (R3.1, R3.4).
  const handleMarkerTap = useCallback(
    (node: Node) => {
      onMarkerTap(node.id)
    },
    [onMarkerTap],
  )

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn(cameraMotion(400))
  }, [mapRef])

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut(cameraMotion(400))
  }, [mapRef])

  // Recenter is an exit gesture for Spotlight_Mode (R7.3). Lift the isolation
  // first, then run the normal recenter fly-to (R6.3: the recenter's own
  // fly-to proceeds as normal; other exits do not move the camera).
  const handleRecenter = useCallback(() => {
    exitSpotlight()
    recenterUser()
  }, [exitSpotlight, recenterUser])

  useMapMarkers(mapRef, categoryFilter, handleMarkerTap, mapReady, activeVenueId, {
    is3D,
    brushedNodeId,
    onCommitZoom: handleCommitZoom,
    onGlyphLongPress: handleGlyphLongPress,
  })

  // Pinch past Embers while in Constellation peek → full browse funnel.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const handler = () => {
      if (carouselMode !== 'constellation') return
      if (map.getZoom() >= MIN_MARKER_ZOOM) commitZoom({ skipFly: true })
    }
    map.on('zoomend', handler)
    return () => {
      try {
        map.off('zoomend', handler)
      } catch {
        /* map torn down */
      }
    }
  }, [mapRef, mapReady, carouselMode, commitZoom])

  // ── Viewport-change recompute ──
  // User pan/zoom recomputes the Carousel_Order in `area` scope (R6.2). Only
  // wire `moveend` (not `zoom`): zoom fires continuously during programmatic
  // fly-to, and a meaningful pan always ends with moveend anyway. The selection
  // hook debounces internally and ignores micro-moves while still in the
  // citywide `recommended` scope.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // Only recompute for user-driven pan/zoom. The camera's own flyTo (when
    // stepping to the Active_Venue) fires moveend with no `originalEvent`;
    // recomputing on those would rescope the order to whatever is near the venue
    // we just centered, progressively shrinking the browse strip until it
    // collapses to the single active venue and the Flick_Controls gray out.
    const handler = (e: object) => {
      if ((e as { originalEvent?: unknown }).originalEvent) notifyViewportChanged()
    }
    map.on('moveend', handler)
    return () => {
      try {
        map.off('moveend', handler)
      } catch {
        /* map already torn down */
      }
    }
  }, [mapRef, mapReady, notifyViewportChanged])

  // ── First-paint open (cold open → recommended Browse carousel) ──
  // On open we dive straight into the recommended Browse_Mode strip at
  // MAP_ARRIVAL_ZOOM so the consumer immediately sees the top recommended
  // venues, instead of the single-venue Constellation peek + "Zoom in" button.
  // Returning users resume on their retained venue; everyone else leads with
  // the most alive / taste-matched venue (carouselOrder[0] per vibeRank).
  // Skipped when a real Focus_Signal is pending or the carousel is already open.
  //
  // Reuses the Focus_Signal dive (setFocusNodeId): its consumer flies the
  // camera to MAP_ARRIVAL_ZOOM, opens Browse_Mode, and recomputes the order -
  // exactly the "open straight into the recommended venues" behaviour we want,
  // and structurally never the country-zoom peek. See constellation-mode.md.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current || !mapReady) return
    if (useSelectionStore.getState().mode !== 'closed') {
      autoOpenedRef.current = true
      return
    }
    if (focusNodeId) return

    const target = useSelectionStore.getState().lastVenueId ?? carouselOrder[0]
    if (!target) return
    autoOpenedRef.current = true
    setFocusNodeId(target)
  }, [mapReady, carouselOrder, focusNodeId, setFocusNodeId])

  // Fetch rewards for the Active_Venue (Commit_Mode body).
  const { data: nodeRewards } = useQuery({
    queryKey: ['node-rewards', activeVenueId],
    queryFn: () => api.get<{ items: Reward[] }>(`/v1/nodes/${activeVenueId!}/rewards`).then((r) => r.items),
    enabled: !!activeVenueId,
    staleTime: 30_000,
  })

  function handleEnableLocation() {
    void requestLocation().then((pos) => {
      if (pos) {
        mapRef.current?.flyTo({
          center: [pos.lng, pos.lat],
          zoom: USER_VIEW_ZOOM,
          ...cameraMotion(1000),
        })
      } else {
        // Permission still denied, dismiss banner
        setLocationBannerDismissed(true)
      }
    })
  }

  // ── Overlay coordination ──
  // Gates the Onboarding_Hint, Proximity_Nudge_Banner, Notification_Priming_Sheet,
  // and Location_Banner: suppresses the first three while Commit_Mode is open
  // (R17.3), enforces nudge/Location_Banner mutual exclusion (R17.4), and gates
  // priming to after a successful first check-in, once per session (R17.5).
  const overlay = useOverlayCoordinator({
    nudgeAvailable: true,
    locationBannerDismissed,
    hasCompletedFirstCheckIn,
    primingShownThisSession,
    primingDeferred: userId ? isDeferredRecently(userId) : true,
  })

  const activeScore = activeVenueId ? (pulseScores[activeVenueId] ?? 0) : 0

  // City-nodes fetch outcome banner: surface a retry on failure and an honest
  // "quiet" message when a city genuinely has no venues yet, so the user is
  // never left staring at a blank map with no carousel and no explanation.
  const nodesFetchFailed = nodesError && !nodeList
  const cityHasNoVenues = !nodesLoading && !nodesError && Array.isArray(nodeList) && nodeList.length === 0

  return (
    <div className="h-full w-full relative" style={{ background: 'var(--bg-map)' }}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" style={{ background: 'var(--bg-map)' }} />

      {/* Map loading overlay: a calm skeleton wash rather than a bare spinner,
          so first paint reads as the map materialising, not a dead load. */}
      {!mapReady && !mapError && (
        <div
          className="absolute inset-0 z-5 overflow-hidden"
          style={{ background: 'var(--bg-map)' }}
          role="status"
          aria-label={t('map.loading', 'Loading map')}
        >
          <div className="absolute inset-0 animate-shimmer" style={{ background: 'var(--glass-highlight)' }} />
          <div className="absolute inset-x-4 z-10" style={{ bottom: 'calc(var(--nav-height) + 1.5rem)' }}>
            <div className="flex gap-3 overflow-hidden">
              <div className="h-20 w-[200px] shrink-0 rounded-2xl bg-[var(--bg-raised)] animate-pulse" />
              <div className="h-20 w-[200px] shrink-0 rounded-2xl bg-[var(--bg-raised)] animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* Map error fallback */}
      {mapError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[var(--bg-base)] px-6">
          <MapPinOff size={32} strokeWidth={1.5} className="text-[var(--text-muted)]" />
          <h2 className="text-[var(--text-primary)] font-bold text-lg mb-2 text-center mt-4">Map unavailable</h2>
          <p className="text-[var(--text-secondary)] text-sm mb-6 text-center max-w-[280px]">{mapError}</p>
          <button
            onClick={retryMap}
            className="bg-[var(--accent-cta)] text-white font-semibold rounded-xl px-6 py-3 text-sm"
          >
            Retry
          </button>
        </div>
      )}

      <div
        className="absolute left-0 right-0 z-10 pointer-events-none [&>*]:pointer-events-auto"
        style={{ top: 'max(1.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex items-center gap-2 pl-3 pr-1">
          <button
            onClick={() => setSearchOpen(true)}
            aria-label={t('search.open', 'Search venues')}
            className="shrink-0 glass-raised rounded-full w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Search size={18} strokeWidth={1.75} />
          </button>
          <div className="flex-1 min-w-0">
            <CategoryFilterBar onFilter={setCategoryFilter} />
          </div>
        </div>
      </div>

      {mapReady && !mapError && (
        <MapControls
          is3D={is3D}
          bearing={bearing}
          onToggle3D={() => setPitch3D(!is3D)}
          onResetNorth={resetNorth}
          onRecenter={handleRecenter}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          lastKnownPositionFreshAt={lastKnownPositionCapturedAt}
          pauseIdleDrift={pauseIdleDrift}
          onRequestLocation={handleEnableLocation}
        />
      )}

      {/* Location banner, non-blocking */}
      {overlay.showLocationBanner && (
        <div className="absolute left-4 right-4 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)' }}>
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex-1 mr-3">
              <p className="text-[var(--text-primary)] text-xs font-medium">{t('location.permissionTitle')}</p>
            </div>
            <button
              onClick={handleEnableLocation}
              className="bg-[var(--accent-cta)] text-white text-xs font-semibold rounded-lg px-3 py-1.5 mr-2"
            >
              {t('location.enable')}
            </button>
            <button onClick={() => setLocationBannerDismissed(true)} className="text-[var(--text-muted)]">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <ToastOverlay />
      {/* Spotlight exit hint reuses the WhisperChip (R9.1-R9.3). Sweep whispers
          only occur at Constellation zoom and spotlight only exists at or above
          MIN_MARKER_ZOOM, so the two texts are mutually exclusive; precedence is
          whisperText ?? spotlightHint. */}
      <WhisperChip
        text={
          whisperText ??
          (spotlightVenueId ? t('map.spotlightHint', 'Spotlight on. Zoom out or recenter to exit') : null)
        }
      />
      {overlay.showNudge && <ProximityNudgeBanner onNavigate={onNavigate} />}

      {celebration && (
        <CheckInCelebration
          venueName={celebration.venueName}
          fromCount={celebration.fromCount}
          toCount={celebration.toCount}
          totalCheckIns={celebration.totalCheckIns}
          streakCount={celebration.streakCount}
          onDone={() => setCelebration(null)}
        />
      )}

      {/* City venue-data states: failed fetch (retry) or genuinely empty city. */}
      {(nodesFetchFailed || cityHasNoVenues) && (
        <div className="absolute left-4 right-4 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)' }}>
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-[var(--text-primary)] text-xs font-medium flex-1">
              {nodesFetchFailed
                ? t('map.venuesLoadFailed', "Couldn't load venues. Check your connection and try again.")
                : t('map.noVenues', 'Quiet right now. No venues here yet, check back soon.')}
            </p>
            {nodesFetchFailed && (
              <button
                onClick={() => void refetchNodes()}
                className="bg-[var(--accent-cta)] text-white text-xs font-semibold rounded-lg px-3 py-1.5 shrink-0"
              >
                {t('common.retry', 'Retry')}
              </button>
            )}
          </div>
        </div>
      )}

      {liveVibeOnMap && <LiveArchetypeSubscriber token={accessToken ?? undefined} citySlug={citySlug} />}
      <CityPulseToastMount mapReady={mapReady} />

      {/* Peek_Carousel - the two-state browse-and-compare surface (R1.1, R2.x).
          Browse_Mode (swipeable Venue_Card strip + FlickControls) and
          Commit_Mode (full detail body) over a single shared BottomSheet.
          Rendered only while the Map tab is active: the sheet portals to
          document.body, so without this gate it would stay visible over the
          other tabs when the map is hidden (display:none). Selection state
          lives in selectionStore, so the carousel restores on return. */}
      {active && (
        <PeekCarousel
          selection={selection}
          rewards={nodeRewards ?? []}
          pulseScore={activeScore}
          state={getNodeState(activeScore)}
          onCheckIn={checkInFlow.activateCheckIn}
          onSignIn={checkInFlow.activateCheckIn}
          qrFallback={checkInFlow.qrFallback}
          isCheckingIn={checkInFlow.isPending}
          onCheckOut={handleCheckOut}
          isCheckingOut={isCheckingOut}
          categoryFilter={categoryFilter}
        />
      )}

      {/* Auth + QR surfaces owned by the check-in flow. The only auth entry
          reachable from the map is the email/password + Google OAuth
          SignInSheet - no phone-number or SMS surface (R20.1). All of these
          portal to document.body, so they are gated on `active` for the same
          reason as the Peek_Carousel: without it an open sheet would stay
          visible over the other tabs while the map is hidden. */}
      {active && (
        <>
          <SignInSheet isOpen={checkInFlow.signInOpen} onClose={checkInFlow.closeSignIn} onNavigate={onNavigate} />
          <QrScannerSheet
            isOpen={checkInFlow.qrScannerOpen}
            onClose={checkInFlow.closeQrScanner}
            onScanned={checkInFlow.onQrScanned}
          />

          <SearchSheet
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
            onSelectNode={(result: SearchResult) => {
              setSearchOpen(false)
              // Ensure the searched venue is resolvable by the Selection_Model and
              // the camera/detail layers even if it is not in the current city
              // node set, then route the selection through the single model (R13.4).
              if (!useMapStore.getState().nodes[result.id]) {
                const node: Node = {
                  id: result.id,
                  name: result.name,
                  slug: result.slug,
                  category: result.category as Node['category'],
                  lat: result.lat,
                  lng: result.lng,
                  cityId: '',
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
                }
                addNode(node)
              }
              onSearchSelect(result.id)
            }}
          />

          {overlay.showPriming && userId && lastKnownPosition && (
            <NotificationPrimingSheet
              isOpen
              onClose={() => setPrimingShownThisSession(true)}
              lat={lastKnownPosition.lat}
              lng={lastKnownPosition.lng}
              userId={userId}
            />
          )}
        </>
      )}
    </div>
  )
}
