import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { Avatar } from '@area-code/shared/components/Avatar'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { formatRelativeTime } from '@area-code/shared/lib/formatters'
import type { Tier } from '@area-code/shared/types'

interface FeedItem {
  id: string
  checkedInAt: string
  user: { id: string; username: string; displayName: string; avatarUrl: string | null; tier: string }
  node: { id: string; name: string; slug: string; category: string }
}

interface FeedResponse {
  items: FeedItem[]
  nextCursor: string | null
  hasMore: boolean
}

export function FeedScreen() {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)

  const { data, isLoading } = useQuery({
    queryKey: ['feed'],
    queryFn: () => api.get<FeedResponse>('/v1/feed?limit=20'),
    enabled: isAuthenticated,
    staleTime: 30_000,
  })

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full px-5">
        <p className="text-[var(--text-secondary)] text-sm text-center">
          {t('auth.gated.feedSignIn')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4">
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-4">
        {t('feed.title')}
      </h1>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {data.items.map((item) => (
            <div
              key={item.id}
              className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3"
            >
              <Avatar
                url={item.user.avatarUrl}
                displayName={item.user.displayName}
                size="sm"
                tier={item.user.tier as Tier}
              />
              <div className="flex-1">
                <p className="text-[var(--text-primary)] text-sm">
                  <span className="font-medium">{item.user.username}</span>
                  {' checked in to '}
                  <span className="font-medium">{item.node.name}</span>
                </p>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">
                  {formatRelativeTime(item.checkedInAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[var(--text-muted)] text-sm text-center py-8">
          {t('feed.emptyState')}
        </p>
      )}
    </div>
  )
}
