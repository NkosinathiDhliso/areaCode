import { EmptyState } from '@area-code/shared/components/EmptyState'
import { RedemptionCodeCard } from '@area-code/shared/components/RedemptionCodeCard'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { REWARD_EXPIRY_NOTICE } from '@area-code/shared/constants/legal'
import { useGeolocation, useUnclaimedRewards } from '@area-code/shared/hooks'
import { api } from '@area-code/shared/lib/api'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { GetHistoryList } from '../components/rewards/GetHistoryList'
import { RecentClaimsStrip } from '../components/rewards/RecentClaimsStrip'
import { RewardsList } from '../components/rewards/RewardsList'
import type { NearbyReward } from '../components/rewards/types'
import { useClaimedHistory } from '../hooks/useClaimedHistory'
import { useRecentClaims } from '../hooks/useRecentClaims'
import type { AppRoute } from '../types'

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

  // Acquire location on mount when missing. Without this, a hard refresh while
  // sitting on /gets renders an empty list (locationStore is not persisted), so
  // re-trigger the GPS request here to keep the screen self-sufficient.
  useEffect(() => {
    if (!isAuthenticated || pos) return
    void requestLocation()
  }, [isAuthenticated, pos, requestLocation])

  const online = connectivity !== 'offline' && isAuthenticated

  // Ranked "near you" gets (server orders taste-first; see ranking.ts).
  const {
    data: rewards,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['rewards', 'near-me', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<NearbyReward[]>(`/v1/rewards/near-me?lat=${pos?.lat ?? -26.2041}&lng=${pos?.lng ?? 28.0473}`),
    enabled: online,
    staleTime: 30_000,
  })

  const { data: recentClaims } = useRecentClaims(pos, online)
  const { data: history } = useClaimedHistory(online)
  // Earned-but-unredeemed codes (the wallet), surfaced at the top so a code the
  // user just earned is immediately presentable to staff.
  const { rewards: earnedCodes } = useUnclaimedRewards()

  // Tapping any get/claim jumps to that venue on the map with its detail sheet
  // open; MapScreen reads `focusNodeId` and handles the fly-to + sheet open.
  function handleSelectNode(nodeId: string) {
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
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      {earnedCodes.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[var(--text-primary)] font-bold text-lg font-[Syne] mb-1">{t('rewards.yourCodes')}</h2>
          <p className="text-[var(--text-muted)] text-xs mb-3">{t('rewards.yourCodesHint')}</p>
          <div className="flex flex-col gap-3">
            {earnedCodes.map((c) => (
              <RedemptionCodeCard
                key={c.id}
                rewardTitle={c.rewardTitle}
                redemptionCode={c.redemptionCode}
                nodeName={c.nodeName}
                codeExpiresAt={c.codeExpiresAt}
                hint={t('rewards.codeHint')}
              />
            ))}
          </div>
        </div>
      )}

      <RecentClaimsStrip claims={recentClaims ?? []} t={t} onSelect={handleSelectNode} />

      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-1">{t('rewards.nearYou')}</h1>
      <p className="text-[var(--text-muted)] text-xs mb-4">{REWARD_EXPIRY_NOTICE}</p>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : rewards && rewards.length > 0 ? (
        <RewardsList rewards={rewards} t={t} onSelect={handleSelectNode} />
      ) : (
        <EmptyState icon="reward" message={t('rewards.noneNearby')} />
      )}

      <GetHistoryList history={history ?? []} t={t} />
    </div>
  )
}
