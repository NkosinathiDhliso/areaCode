import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPinOff } from 'lucide-react'

import { api } from '@area-code/shared/lib/api'
import { useMapStore, useConsumerAuthStore, useLocationStore, useUserStore } from '@area-code/shared/stores'
import { useGeolocation, useCheckIn, useNodeArchetype, useCityPulseToast } from '@area-code/shared/hooks'
import { useLiveVibeOnMap } from '@area-code/shared/lib/featureGating'
import { Spinner } from '@area-code/shared/components/Spinner'
import type { Node, NodeCategory, Reward } from '@area-code/shared/types'

import { useMapInit } from '../hooks/useMapInit'
import { useMapMarkers } from '../hooks/useMapMarkers'
import { useMapSockets } from '../hooks/useMapSockets'
import { getNodeState } from '../lib/mapHelpers'
import { CategoryFilterBar } from '../components/CategoryFilterBar'
import { ToastOverlay } from '../components/ToastOverlay'
import { ProximityNudgeBanner } from '../components/ProximityNudgeBanner'
import { NodeDetailSheet } from '../components/NodeDetailSheet'
import { SignupSheet } from '../components/SignupSheet'
import { SearchSheet, type SearchResult } from '../components/SearchSheet'
import { NotificationPrimingSheet, isDeferredRecently } from '../components/NotificationPrimingSheet'
import { MapControls } from '../components/MapControls'
import type { AppRoute } from '../types'

interface MapScreenProps {
  onNavigate: (route: AppRoute) => void
}

const DEFAULT_ZOOM = 13

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
  const pulseScores = useMapStore((s) => s.pulseScores)
  const nodesById = useMapStore((s) => s.nodes)
  const focusNodeId = useMapStore((s) => s.focusNodeId)
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const permissionState = useLocationStore((s) => s.permissionState)
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const lastKnownPositionCapturedAt = useLocationStore((s) => s.capturedAt)
  const onboarding = useUserStore((s) => s.onboarding)
  const markHintSeen = useUserStore((s) => s.markHintSeen)
  const { requestLocation, geoStatus } = useGeolocation()
  const { checkIn, isPending: checkInPending, qrFallback, resetQrFallback } = useCheckIn()

  const citySlug = useUserStore((s) => s.user?.citySlug) ?? 'johannesburg'

  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  /**
   * True when the sheet was opened via the cross-screen focus signal (e.g.
   * a tap on the Gets list). Drives a lighter backdrop so the user keeps
   * seeing pulsing neighbour venues, planting the second-outing thought.
   */
  const [sheetOpenedFromFocus, setSheetOpenedFromFocus] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<NodeCategory | null>(null)
  const [primingOpen, setPrimingOpen] = useState(false)
  const [primingShownThisSession, setPrimingShownThisSession] = useState(false)

  // Socket subscriptions, citySlug passed for anonymous room join
  const userId = useConsumerAuthStore((s) => s.userId)
  useMapSockets(citySlug, accessToken ?? undefined, userId)

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

  // Geolocation acquisition via the GPS state machine hook
  useEffect(() => {
    void requestLocation().then((pos) => {
      if (pos) {
        mapRef.current?.flyTo({
          center: [pos.lng, pos.lat],
          zoom: DEFAULT_ZOOM,
        })
      }
    })
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Node tap handler, dismiss onboarding hint on first tap
  const handleNodeTap = useCallback(
    (node: Node) => {
      setSelectedNode(node)
      setSheetOpen(true)
      setSheetOpenedFromFocus(false)
      resetQrFallback()
      if (!onboarding.hintSeen) markHintSeen('hintSeen')
    },
    [onboarding.hintSeen, markHintSeen, resetQrFallback],
  )

  // Marker management (extracted hook)
  useMapMarkers(mapRef, categoryFilter, handleNodeTap, mapReady)

  // Cross-screen focus: when another surface (e.g. Gets list) sets focusNodeId,
  // fly to that node and open its detail sheet. We wait for the map to be
  // ready and the node to be present in the store before consuming the signal.
  //
  // Zoom 14 (not 16) is deliberate: it keeps several neighbouring venues in
  // view alongside the focused one. Combined with the lighter backdrop on the
  // sheet, the user sees other pulsing nodes while reading the discount —
  // that peripheral vision is what plants "and then we go to X next" in their
  // head before they leave for the first venue.
  useEffect(() => {
    if (!focusNodeId || !mapReady) return
    const node = nodesById[focusNodeId]
    if (!node) return
    setSelectedNode(node)
    setSheetOpen(true)
    setSheetOpenedFromFocus(true)
    resetQrFallback()
    mapRef.current?.flyTo({ center: [node.lng, node.lat], zoom: 14 })
    setFocusNodeId(null)
  }, [focusNodeId, mapReady, nodesById, mapRef, setFocusNodeId, resetQrFallback])

  // Fetch rewards for the selected node
  const { data: nodeRewards } = useQuery({
    queryKey: ['node-rewards', selectedNode?.id],
    queryFn: () => api.get<{ items: Reward[] }>(`/v1/nodes/${selectedNode!.id}/rewards`).then((r) => r.items),
    enabled: !!selectedNode,
    staleTime: 30_000,
  })

  // Check-in handler using the enhanced useCheckIn hook
  async function handleCheckIn() {
    if (!selectedNode) return

    // Acquire fresh location before check-in
    const pos = await requestLocation()
    if (!pos && geoStatus !== 'poorAccuracy') return

    const payload = {
      nodeId: selectedNode.id,
      type: 'reward' as const,
      ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
    }

    const result = await checkIn(payload)

    if (result) {
      // Haptic feedback on successful check-in (Issue #31)
      if (navigator.vibrate) navigator.vibrate(50)
      setSheetOpen(false)
      setSheetOpenedFromFocus(false)
      void queryClient.invalidateQueries({ queryKey: ['nodes'] })
      if (!onboarding.firstCheckIn) {
        markHintSeen('firstCheckIn')
        // Show notification priming after first check-in if not deferred and not already shown
        if (userId && !primingShownThisSession && !isDeferredRecently(userId)) {
          setPrimingShownThisSession(true)
          setPrimingOpen(true)
        }
      }
    }
  }

  function handleEnableLocation() {
    void requestLocation().then((pos) => {
      if (pos) {
        mapRef.current?.flyTo({
          center: [pos.lng, pos.lat],
          zoom: DEFAULT_ZOOM,
        })
      } else {
        // Permission still denied, dismiss banner
        setLocationBannerDismissed(true)
      }
    })
  }

  const selectedScore = selectedNode ? (pulseScores[selectedNode.id] ?? 0) : 0
  const [locationBannerDismissed, setLocationBannerDismissed] = useState(false)
  const showLocationBanner = permissionState === 'denied' && !locationBannerDismissed

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

      <div className="absolute top-4 left-0 right-0 z-10 pointer-events-none [&>*]:pointer-events-auto">
        <CategoryFilterBar onFilter={setCategoryFilter} />
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
      {showLocationBanner && (
        <div className="absolute top-16 left-4 right-4 z-20">
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

      {!onboarding.hintSeen && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none [&>*]:pointer-events-auto">
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center gap-2 shadow-lg">
            <span className="text-[var(--text-secondary)] text-sm">{t('map.tapHint')}</span>
            <button
              onClick={() => markHintSeen('hintSeen')}
              className="text-[var(--text-muted)] text-xs"
              aria-label={t('map.tapHint')}
            >
              <svg
                width="16"
                height="16"
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
      <ProximityNudgeBanner onNavigate={onNavigate} />

      {liveVibeOnMap && <LiveArchetypeSubscriber token={accessToken ?? undefined} citySlug={citySlug} />}
      <CityPulseToastMount mapReady={mapReady} />

      <NodeDetailSheet
        node={selectedNode}
        rewards={nodeRewards ?? []}
        pulseScore={selectedScore}
        state={getNodeState(selectedScore)}
        isOpen={sheetOpen}
        onClose={() => {
          setSheetOpen(false)
          setSheetOpenedFromFocus(false)
        }}
        onCheckIn={handleCheckIn}
        onSignup={() => {
          setSheetOpen(false)
          setSheetOpenedFromFocus(false)
          setSignupOpen(true)
        }}
        qrFallback={qrFallback}
        isCheckingIn={checkInPending}
        transparentBackdrop={sheetOpenedFromFocus}
      />

      <SignupSheet isOpen={signupOpen} onClose={() => setSignupOpen(false)} onNavigate={onNavigate} />

      <SearchSheet
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectNode={(result: SearchResult) => {
          setSearchOpen(false)
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
          setSelectedNode(node)
          setSheetOpen(true)
          setSheetOpenedFromFocus(false)
          mapRef.current?.flyTo({ center: [node.lng, node.lat], zoom: 16 })
        }}
      />

      {primingOpen && userId && lastKnownPosition && (
        <NotificationPrimingSheet
          isOpen={primingOpen}
          onClose={() => setPrimingOpen(false)}
          lat={lastKnownPosition.lat}
          lng={lastKnownPosition.lng}
          userId={userId}
        />
      )}
    </div>
  )
}
