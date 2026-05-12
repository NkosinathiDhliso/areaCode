import { useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
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
  const sentinelRef = useRef<HTMLDivElement>(null)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ limit: '20' })
      if (pageParam) params.set('cursor', pageParam)
      return api.get<FeedResponse>(`/v1/feed?${params}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    staleTime: 30_000,
  })

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage()
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  )

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [handleIntersect])

  const allItems = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4" data-scroll-container>
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-4">
        {t('feed.title')}
      </h1>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-[var(--text-muted)] text-sm text-center">
            {t('feed.loadError', 'Couldn\'t load your feed. Check your connection.')}
          </p>
          <button
            onClick={() => void refetch()}
            className="text-[var(--accent)] text-sm font-medium"
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      ) : allItems.length > 0 ? (
        <div className="flex flex-col gap-3">
          {allItems.map((item) => (
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

          <div ref={sentinelRef} className="h-8" />

          {isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <span className="text-[var(--text-muted)] text-4xl opacity-40">👋</span>
          <p className="text-[var(--text-muted)] text-sm text-center max-w-xs">
            {t('feed.emptyState', 'Your feed is empty. Follow friends to see their check-ins here.')}
          </p>
        </div>
      )}
    </div>
  )
}
