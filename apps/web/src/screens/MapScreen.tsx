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

  const { containerRef, mapRef, mapReady } = useMapInit()
  const { setNodes, pulseScores } = useMapStore()
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const permissionState = useLocationStore((s) => s.permissionState)
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const { onboarding, markHintSeen } = useUserStore()
  const { requestLocation, geoStatus } = useGeolocation()
  const { checkIn, qrFallback, resetQrFallback } = useCheckIn()

  const citySlug = useUserStore((s) => s.user?.citySlug) ?? 'johannesburg'

  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<NodeCategory | null>(null)
  const [browseOnly, setBrowseOnly] = useState(false)
  const [primingOpen, setPrimingOpen] = useState(false)
  const [primingShownThisSession, setPrimingShownThisSession] = useState(false)

  // Socket subscriptions — citySlug passed for anonymous room join
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

  // Node tap handler — dismiss onboarding hint on first tap
  const handleNodeTap = useCallback((node: Node) => {
    setSelectedNode(node)
    setSheetOpen(true)
    resetQrFallback()
    if (!onboarding.hintSeen) markHintSeen('hintSeen')
  }, [onboarding.hintSeen, markHintSeen, resetQrFallback])

  // Marker management (extracted hook)
  useMapMarkers(mapRef, categoryFilter, handleNodeTap, mapReady)

  // Fetch rewards for the selected node
  const { data: nodeRewards } = useQuery({
    queryKey: ['node-rewards', selectedNode?.id],
    queryFn: () => api.get<Reward[]>(`/v1/nodes/${selectedNode!.id}/rewards`),
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
    // Re-request location — browser will show the native permission prompt
    void requestLocation().then((pos) => {
      if (pos) {
        mapRef.current?.flyTo({
          center: [pos.lng, pos.lat],
          zoom: DEFAULT_ZOOM,
        })
      }
    })
  }

  function handleBrowseOnly() {
    setBrowseOnly(true)
  }

  const selectedScore = selectedNode ? (pulseScores[selectedNode.id] ?? 0) : 0
  const showPermissionPrompt = permissionState === 'denied' && !browseOnly

  return (
    <div className="h-full w-full relative">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      <div className="absolute top-4 left-0 right-0 z-10">
        <CategoryFilterBar onFilter={setCategoryFilter} />
      </div>

      {!onboarding.hintSeen && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center gap-2">
            <span className="text-[var(--text-secondary)] text-sm">
              {t('map.tapHint')}
            </span>
            <button
              onClick={() => markHintSeen('hintSeen')}
              className="text-[var(--text-muted)] text-xs"
              aria-label={t('map.tapHint')}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <ToastOverlay />

      {/* Full-screen location permission prompt */}
      {showPermissionPrompt && (
        <div className="absolute inset-0 z-30 bg-[var(--bg-surface)] flex flex-col items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <p className="text-[var(--text-primary)] text-lg font-semibold font-[Syne] mb-6">
              {t('location.permissionTitle')}
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleEnableLocation}
                className="w-full bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base"
              >
                {t('location.enable')}
              </button>
              <button
                onClick={handleBrowseOnly}
                className="w-full bg-[var(--bg-raised)] text-[var(--text-secondary)] font-semibold rounded-xl py-4 text-base border border-[var(--border)]"
              >
                {t('location.browseOnly')}
              </button>
            </div>
          </div>
        </div>
      )}

      <NodeDetailSheet
        node={selectedNode}
        rewards={nodeRewards ?? []}
        pulseScore={selectedScore}
        state={getNodeState(selectedScore)}
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCheckIn={handleCheckIn}
        onSignup={() => { setSheetOpen(false); setSignupOpen(true) }}
        qrFallback={qrFallback}
      />

      <SignupSheet
        isOpen={signupOpen}
        onClose={() => setSignupOpen(false)}
        onNavigate={onNavigate}
      />

      <SearchSheet
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectNode={(result: SearchResult) => {
          setSearchOpen(false)
          const node: Node = {
            id: result.id, name: result.name, slug: result.slug,
            category: result.category as Node['category'],
            lat: result.lat, lng: result.lng,
            cityId: '', businessId: null, submittedBy: null,
            claimStatus: 'unclaimed', claimCipcStatus: null,
            nodeColour: 'default', nodeIcon: null,
            qrCheckinEnabled: false, isVerified: false, isActive: true, createdAt: '',
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
