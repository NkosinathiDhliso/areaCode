import { Spinner } from '@area-code/shared/components/Spinner'
import { useGeolocation, useNodeArchetype, useCityPulseToast } from '@area-code/shared/hooks'
import { api } from '@area-code/shared/lib/api'
import { useLiveVibeOnMap } from '@area-code/shared/lib/featureGating'
import {
  useMapStore,
  useConsumerAuthStore,
  useLocationStore,
  useUserStore,
  useSelectionStore,
} from '@area-code/shared/stores'
import type { Node, NodeCategory, Reward } from '@area-code/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPinOff, Search } from 'lucide-react'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryFilterBar } from '../components/CategoryFilterBar'
import { MapControls } from '../components/MapControls'
import { NotificationPrimingSheet, isDeferredRecently } from '../components/NotificationPrimingSheet'
import { PeekCarousel } from '../components/PeekCarousel'
import { ProximityNudgeBanner } from '../components/ProximityNudgeBanner'
import { QrScannerSheet } from '../components/QrScannerSheet'
import { SearchSheet, type SearchResult } from '../components/SearchSheet'
import { SignupSheet } from '../components/SignupSheet'
import { ToastOverlay } from '../components/ToastOverlay'
import { useCarouselSelection } from '../hooks/useCarouselSelection'
import { useCheckInFlow } from '../hooks/useCheckInFlow'
import { useHasLiveGets } from '../hooks/useHasLiveGets'
import { useMapInit } from '../hooks/useMapInit'
import { useMapMarkers } from '../hooks/useMapMarkers'
import { useMapSockets } from '../hooks/useMapSockets'
import { useOverlayCoordinator } from '../hooks/useOverlayCoordinator'
import { getNodeState } from '../lib/mapHelpers'
import type { AppRoute } from '../types'

interface MapScreenProps {
  onNavigate: (route: AppRoute) => void
}

/**
 * Zoom used when the user explicitly asks to be located (Recenter button or
 * the "Enable location" banner): roughly a 20 km radius around them. The map
 * otherwise opens on the full-country overview from useMapInit.
 */
const USER_VIEW_ZOOM = 10

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

export function MapScreen({ onNavigate }: MapScreenProps) {
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

  // ── Selection_Model: the single source of truth for the Active_Venue ──
  // Drives the Peek_Carousel, the camera, and the marker layer. Replaces the
  // legacy ad-hoc selectedNode/sheetOpen/handleFlick state.
  const selection = useCarouselSelection({ categoryFilter, mapReady })
  const { activeVenueId, notifyViewportChanged, carouselOrder, selectVenue, onMarkerTap, onSearchSelect, dismiss } =
    selection

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
  const { data: nodeList } = useQuery({
    queryKey: ['nodes', citySlug],
    queryFn: () => api.get<Node[]>(`/v1/nodes/${citySlug}`),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (nodeList) {
      setNodes(nodeList)
    }
  }, [nodeList, setNodes])

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
  const handleCheckInSuccess = useCallback(() => {
    dismiss()
    void queryClient.invalidateQueries({ queryKey: ['nodes'] })
    if (!onboarding.firstCheckIn) {
      markHintSeen('firstCheckIn')
      setHasCompletedFirstCheckIn(true)
    }
  }, [dismiss, queryClient, onboarding.firstCheckIn, markHintSeen])

  const checkInFlow = useCheckInFlow({ onCheckInSuccess: handleCheckInSuccess })

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

  useMapMarkers(mapRef, categoryFilter, handleMarkerTap, mapReady, activeVenueId)

  // ── Viewport-change recompute ──
  // Pan/zoom recomputes the in-viewport Carousel_Order (R6.2). The selection
  // hook debounces internally, so wiring both `moveend` and `zoom` is safe.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // Only recompute the in-viewport order for user-driven pan/zoom. The
    // camera's own flyTo (when stepping to the Active_Venue) fires moveend/zoom
    // with no `originalEvent`; recomputing on those would rescope the order to
    // whatever is near the venue we just centered, progressively shrinking the
    // browse strip until it collapses to the single active venue and the
    // Flick_Controls gray out (R6.2 applies to user navigation, not self-moves).
    const handler = (e: object) => {
      if ((e as { originalEvent?: unknown }).originalEvent) notifyViewportChanged()
    }
    map.on('moveend', handler)
    map.on('zoom', handler)
    return () => {
      try {
        map.off('moveend', handler)
        map.off('zoom', handler)
      } catch {
        /* map already torn down */
      }
    }
  }, [mapRef, mapReady, notifyViewportChanged])

  // ── First-paint open into Browse_Mode (R1.1) ──
  // Once the map is ready and the Carousel_Order has at least one in-viewport
  // venue, open the carousel in Browse_Mode on the first (highest-ranked)
  // venue. Skipped when a Focus_Signal is pending (it opens the carousel on its
  // own target) or when the carousel is already open.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current || !mapReady) return
    if (useSelectionStore.getState().mode !== 'closed') {
      autoOpenedRef.current = true
      return
    }
    if (focusNodeId) return
    const first = carouselOrder[0]
    if (!first) return
    autoOpenedRef.current = true
    selectVenue(first, 'swipe')
  }, [mapReady, carouselOrder, focusNodeId, selectVenue])

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

  return (
    <div className="h-full w-full relative" style={{ background: 'var(--bg-map)' }}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" style={{ background: 'var(--bg-map)' }} />

      {/* Map loading overlay */}
      {!mapReady && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center z-5" style={{ background: 'var(--bg-map)' }}>
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <span className="text-[var(--text-muted)] text-sm">Loading map...</span>
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
            className="bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 text-sm"
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
          onRecenter={recenterUser}
          lastKnownPositionFreshAt={lastKnownPositionCapturedAt}
          pauseIdleDrift={pauseIdleDrift}
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
              className="bg-[var(--accent)] text-white text-xs font-semibold rounded-lg px-3 py-1.5 mr-2"
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
      {overlay.showNudge && <ProximityNudgeBanner onNavigate={onNavigate} />}

      {liveVibeOnMap && <LiveArchetypeSubscriber token={accessToken ?? undefined} citySlug={citySlug} />}
      <CityPulseToastMount mapReady={mapReady} />

      {/* Peek_Carousel - the two-state browse-and-compare surface (R1.1, R2.x).
          Browse_Mode (swipeable Venue_Card strip + FlickControls) and
          Commit_Mode (full detail body) over a single shared BottomSheet. */}
      <PeekCarousel
        selection={selection}
        rewards={nodeRewards ?? []}
        pulseScore={activeScore}
        state={getNodeState(activeScore)}
        onCheckIn={checkInFlow.activateCheckIn}
        onSignup={checkInFlow.activateCheckIn}
        qrFallback={checkInFlow.qrFallback}
        isCheckingIn={checkInFlow.isPending}
        categoryFilter={categoryFilter}
      />

      {/* Auth + QR surfaces owned by the check-in flow. The only auth entry
          reachable from the map is the email/password + Google OAuth
          SignupSheet - no phone-number or SMS surface (R20.1). */}
      <SignupSheet isOpen={checkInFlow.signupOpen} onClose={checkInFlow.closeSignup} onNavigate={onNavigate} />
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
    </div>
  )
}
