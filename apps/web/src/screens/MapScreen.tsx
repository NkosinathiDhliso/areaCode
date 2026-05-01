import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@area-code/shared/lib/api'
import { useMapStore, useConsumerAuthStore, useLocationStore, useUserStore } from '@area-code/shared/stores'
import { useGeolocation, useCheckIn } from '@area-code/shared/hooks'
import type { Node, NodeCategory, Reward } from '@area-code/shared/types'

import { useMapInit } from '../hooks/useMapInit'
import { useMapMarkers } from '../hooks/useMapMarkers'
import { useMapSockets } from '../hooks/useMapSockets'
import { getNodeState } from '../lib/mapHelpers'
import { CategoryFilterBar } from '../components/CategoryFilterBar'
import { ToastOverlay } from '../components/ToastOverlay'
import { NodeDetailSheet } from '../components/NodeDetailSheet'
import { SignupSheet } from '../components/SignupSheet'
import { SearchSheet, type SearchResult } from '../components/SearchSheet'
import { NotificationPrimingSheet, isDeferredRecently } from '../components/NotificationPrimingSheet'
import type { AppRoute } from '../types'

interface MapScreenProps {
  onNavigate: (route: AppRoute) => void
}

const DEFAULT_ZOOM = 13

// Use the user's city from their profile, fallback to Johannesburg
function getUserCitySlug(): string {
  const userStore = useUserStore.getState()
  return userStore.user?.citySlug ?? 'johannesburg'
}

export function MapScreen({ onNavigate }: MapScreenProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { containerRef, mapRef, mapReady, mapError, retryMap } = useMapInit()
  const setNodes = useMapStore((s) => s.setNodes)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const permissionState = useLocationStore((s) => s.permissionState)
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const onboarding = useUserStore((s) => s.onboarding)
  const markHintSeen = useUserStore((s) => s.markHintSeen)
  const { requestLocation, geoStatus } = useGeolocation()
  const { checkIn, qrFallback, resetQrFallback } = useCheckIn()

  const citySlug = useUserStore((s) => s.user?.citySlug) ?? 'johannesburg'

  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<NodeCategory | null>(null)
  const [primingOpen, setPrimingOpen] = useState(false)
  const [primingShownThisSession, setPrimingShownThisSession] = useState(false)

  // Socket subscriptions, citySlug passed for anonymous room join
  const userId = useConsumerAuthStore((s) => s.userId)
  useMapSockets(citySlug, accessToken ?? undefined, userId)

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
      resetQrFallback()
      if (!onboarding.hintSeen) markHintSeen('hintSeen')
    },
    [onboarding.hintSeen, markHintSeen, resetQrFallback],
  )

  // Marker management (extracted hook)
  useMapMarkers(mapRef, categoryFilter, handleNodeTap, mapReady)

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
    <div className="h-full w-full relative">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Map error fallback */}
      {mapError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[var(--bg-base)] px-6">
          <div className="text-4xl mb-4">🗺️</div>
          <h2 className="text-[var(--text-primary)] font-bold text-lg mb-2 text-center">Map unavailable</h2>
          <p className="text-[var(--text-secondary)] text-sm mb-6 text-center max-w-[280px]">{mapError}</p>
          <button
            onClick={retryMap}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 text-sm"
          >
            Retry
          </button>
        </div>
      )}

      <div className="absolute top-4 left-0 right-0 z-10">
        <CategoryFilterBar onFilter={setCategoryFilter} />
      </div>

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
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center gap-2">
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

      <NodeDetailSheet
        node={selectedNode}
        rewards={nodeRewards ?? []}
        pulseScore={selectedScore}
        state={getNodeState(selectedScore)}
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCheckIn={handleCheckIn}
        onSignup={() => {
          setSheetOpen(false)
          setSignupOpen(true)
        }}
        qrFallback={qrFallback}
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
