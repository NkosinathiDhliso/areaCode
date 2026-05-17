import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useGeolocation } from '@area-code/shared/hooks'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { EmptyState } from '@area-code/shared/components/EmptyState'
import { CountdownBadge } from '@area-code/shared/components/CountdownBadge'
import { REWARD_EXPIRY_NOTICE } from '@area-code/shared/constants/legal'
import type { AppRoute } from '../types'

interface NearbyReward {
  id: string
  title: string
  type: string
  totalSlots: number | null
  claimedCount: number
  nodeId: string
  nodeName: string
  nodeSlug: string
  distance: number
  expiresAt: string | null
}

interface RewardsScreenProps {
  onNavigate: (route: AppRoute) => void
}

export function RewardsScreen({ onNavigate }: RewardsScreenProps) {
  const { t } = useTranslation()
  const pos = useLocationStore((s) => s.lastKnownPosition)
  const connectivity = useConnectivityStore((s) => s.state)
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)
  const { requestLocation } = useGeolocation()

  /**
   * Acquire location on mount when missing.
   *
   * Without this, a hard refresh while sitting on /gets renders an empty
   * list: locationStore is not persisted, so `pos` is null until something
   * (previously only MapScreen) calls requestLocation. The query falls back
   * to the JHB downtown default coords, and any users elsewhere see "no
   * gets nearby". Refresh-on-/gets is the exact path the bug report calls
   * out — re-trigger the GPS request here so the screen is self-sufficient.
   */
  useEffect(() => {
    if (!isAuthenticated || pos) return
    void requestLocation()
  }, [isAuthenticated, pos, requestLocation])

  // Near-me rewards require auth
  const {
    data: rewards,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['rewards', 'near-me', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<NearbyReward[]>(`/v1/rewards/near-me?lat=${pos?.lat ?? -26.2041}&lng=${pos?.lng ?? 28.0473}`),
    enabled: connectivity !== 'offline' && isAuthenticated,
    staleTime: 30_000,
  })

  /**
   * Tapping a reward card jumps to that venue on the map with its detail
   * sheet open. The map screen reads `focusNodeId` from the shared store and
   * handles the fly-to + sheet open in one effect.
   */
  function handleSelectReward(nodeId: string) {
    setFocusNodeId(nodeId)
    onNavigate('map')
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full px-5">
        <p className="text-[var(--text-muted)] text-sm text-center">{t('auth.gated.signIn')}</p>
      </div>
    )
  }

  if (connectivity === 'offline') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)] text-sm">{t('rewards.unavailableOffline')}</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full px-5">
        <p className="text-[var(--text-secondary)] text-sm text-center">
          {t('errors.loadFailed', 'Failed to load rewards. Please try again.')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4" data-scroll-container>
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-1">{t('rewards.nearYou')}</h1>
      <p className="text-[var(--text-muted)] text-xs mb-4">{REWARD_EXPIRY_NOTICE}</p>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : rewards && rewards.length > 0 ? (
        <RewardsList rewards={rewards} t={t} onSelect={handleSelectReward} />
      ) : (
        <EmptyState icon="reward" message={t('rewards.noneNearby')} />
      )}
    </div>
  )
}

function RewardsList({
  rewards,
  t,
  onSelect,
}: {
  rewards: NearbyReward[]
  t: (k: string) => string
  onSelect: (nodeId: string) => void
}) {
  const now = Date.now()
  const live: NearbyReward[] = []
  const expired: NearbyReward[] = []
  for (const r of rewards) {
    if (r.expiresAt && Date.parse(r.expiresAt) <= now) expired.push(r)
    else live.push(r)
  }

  return (
    <div className="flex flex-col gap-6">
      {live.length > 0 && (
        <div className="flex flex-col gap-3">
          {live.map((r) => (
            <RewardCard key={r.id} reward={r} t={t} onSelect={onSelect} />
          ))}
        </div>
      )}
      {expired.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[var(--text-muted)] text-xs uppercase tracking-wide">{t('rewards.expiredHeading')}</h2>
          {expired.map((r) => (
            <RewardCard key={r.id} reward={r} t={t} expired />
          ))}
        </div>
      )}
    </div>
  )
}

function RewardCard({
  reward: r,
  t,
  expired = false,
  onSelect,
}: {
  reward: NearbyReward
  t: (k: string) => string
  expired?: boolean
  onSelect?: (nodeId: string) => void
}) {
  const slotsLeft = r.totalSlots ? r.totalSlots - r.claimedCount : null
  const isLow = slotsLeft !== null && slotsLeft <= 5
  const interactive = !expired && !!onSelect

  const content = (
    <div className="flex flex-row items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-sm font-medium">{r.title}</p>
        <p className="text-[var(--text-muted)] text-xs mt-1">
          {r.nodeName} · {Math.round(r.distance)}m away
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <CountdownBadge expiresAt={r.expiresAt} />
        {slotsLeft !== null && !expired && (
          <span className={`text-xs font-medium ${isLow ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
            {slotsLeft} {t('node.left')}
          </span>
        )}
      </div>
    </div>
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={() => onSelect!(r.nodeId)}
        aria-label={t('rewards.viewOnMap')}
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 text-left transition-all duration-150 hover:border-[var(--accent)] active:scale-[0.99] focus:outline-none focus:border-[var(--accent)]"
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className={`bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 ${expired ? 'opacity-60' : ''}`}
    >
      {content}
    </div>
  )
}
