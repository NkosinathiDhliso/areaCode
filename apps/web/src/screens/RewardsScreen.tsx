import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { Skeleton } from '@area-code/shared/components/Skeleton'

interface NearbyReward {
  id: string
  title: string
  type: string
  totalSlots: number | null
  claimedCount: number
  nodeName: string
  nodeSlug: string
  distance: number
  expiresAt: string | null
}

export function RewardsScreen() {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const pos = useLocationStore((s) => s.lastKnownPosition)
  const connectivity = useConnectivityStore((s) => s.state)

  const { data: rewards, isLoading } = useQuery({
    queryKey: ['rewards', 'near-me', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<NearbyReward[]>(
        `/v1/rewards/near-me?lat=${pos?.lat ?? -26.2041}&lng=${pos?.lng ?? 28.0473}`,
      ),
    enabled: isAuthenticated && connectivity !== 'offline',
    staleTime: 30_000,
  })

  if (connectivity === 'offline') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)] text-sm">{t('rewards.unavailableOffline')}</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full px-5">
        <p className="text-[var(--text-secondary)] text-sm text-center">
          {t('auth.gated.rewardsSignIn')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4">
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-4">
        {t('rewards.nearYou')}
      </h1>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : rewards && rewards.length > 0 ? (
        <div className="flex flex-col gap-3">
          {rewards.map((r) => {
            const slotsLeft = r.totalSlots ? r.totalSlots - r.claimedCount : null
            const isLow = slotsLeft !== null && slotsLeft <= 5
            return (
              <div
                key={r.id}
                className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4"
              >
                <div className="flex flex-row items-start justify-between">
                  <div className="flex-1">
                    <p className="text-[var(--text-primary)] text-sm font-medium">{r.title}</p>
                    <p className="text-[var(--text-muted)] text-xs mt-1">
                      {r.nodeName} · {Math.round(r.distance)}m away
                    </p>
                  </div>
                  {slotsLeft !== null && (
                    <span className={`text-xs font-medium ${isLow ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
                      {slotsLeft} {t('node.left')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-[var(--text-muted)] text-sm text-center py-8">
          {t('rewards.noneNearby')}
        </p>
      )}
    </div>
  )
}
