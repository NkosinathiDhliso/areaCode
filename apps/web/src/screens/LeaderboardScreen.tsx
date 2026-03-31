import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { Avatar } from '@area-code/shared/components/Avatar'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import type { LeaderboardEntry, Tier } from '@area-code/shared/types'

interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  userRank: { rank: number; checkInCount: number } | null
}

export function LeaderboardScreen() {
  const { t } = useTranslation()
  const citySlug = 'johannesburg'

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', citySlug],
    queryFn: () => api.get<LeaderboardResponse>(`/v1/leaderboard/${citySlug}`),
    staleTime: 30_000,
  })

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4">
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-1">
        {t('leaderboard.title')}
      </h1>
      <p className="text-[var(--text-muted)] text-xs mb-4">{t('leaderboard.thisWeek')}</p>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : data?.entries && data.entries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {data.entries.map((entry) => (
            <div
              key={entry.userId}
              className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3"
            >
              <span className="text-[var(--text-muted)] text-sm font-medium w-6 text-right">
                {entry.rank}
              </span>
              {entry.isFriend ? (
                <Avatar
                  url={entry.avatarUrl}
                  displayName={entry.displayName ?? ''}
                  size="sm"
                  tier={entry.tier as Tier}
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[var(--bg-raised)] flex items-center justify-center">
                  <TierBadge tier={entry.tier as Tier} />
                </div>
              )}
              <div className="flex-1">
                <p className="text-[var(--text-primary)] text-sm font-medium">
                  {entry.isFriend ? entry.displayName : t('leaderboard.anonymousExplorer')}
                </p>
              </div>
              <TierBadge tier={entry.tier as Tier} />
              <span className="text-[var(--text-secondary)] text-sm font-medium ml-2">
                {entry.checkInCount}
              </span>
            </div>
          ))}

          {/* User's rank pinned at bottom if outside top 50 */}
          {data.userRank && !data.entries.find((e) => e.rank === data.userRank?.rank) && (
            <>
              <div className="border-t border-[var(--border)] my-2" />
              <div className="flex flex-row items-center gap-3 bg-[var(--bg-raised)] border border-[var(--accent)] rounded-2xl px-4 py-3">
                <span className="text-[var(--accent)] text-sm font-medium w-6 text-right">
                  {data.userRank.rank}
                </span>
                <div className="flex-1">
                  <p className="text-[var(--text-primary)] text-sm font-medium">{t('leaderboard.you')}</p>
                </div>
                <span className="text-[var(--text-secondary)] text-sm font-medium">
                  {data.userRank.checkInCount}
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-[var(--text-muted)] text-sm text-center py-8">
          {t('leaderboard.noData')}
        </p>
      )}
    </div>
  )
}
