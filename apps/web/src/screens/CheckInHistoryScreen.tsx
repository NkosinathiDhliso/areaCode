import { useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { EmptyState } from '@area-code/shared/components/EmptyState'
import { UtensilsCrossed, Coffee, Moon, ShoppingBag, Dumbbell, Palette, MapPin, ChevronLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppRoute } from '../types'

interface CheckInHistoryEntry {
  id: string
  nodeId: string
  checkedInAt: string
  node: { name: string; slug: string; category: string }
}

interface CheckInHistoryResponse {
  items: CheckInHistoryEntry[]
  nextCursor: string | null
  hasMore: boolean
}

interface CheckInHistoryScreenProps {
  onNavigate: (route: AppRoute) => void
}

export function CheckInHistoryScreen({ onNavigate }: CheckInHistoryScreenProps) {
  const { t } = useTranslation()
  const sentinelRef = useRef<HTMLDivElement>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } = useInfiniteQuery({
    queryKey: ['check-in-history'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ limit: '20' })
      if (pageParam) params.set('cursor', pageParam)
      return api.get<CheckInHistoryResponse>(`/v1/users/me/check-in-history?${params}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
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

  function formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  const CATEGORY_ICONS: Record<string, LucideIcon> = {
    food: UtensilsCrossed,
    coffee: Coffee,
    nightlife: Moon,
    retail: ShoppingBag,
    fitness: Dumbbell,
    arts: Palette,
  }

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => onNavigate('profile')}
          className="text-[var(--text-muted)] text-sm flex items-center gap-1"
          aria-label={t('common.back', 'Back')}
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <h1 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          {t('profile.checkInHistory', 'Check-in History')}
        </h1>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-2"
            >
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <p className="text-[var(--text-secondary)] text-sm">
            {t('errors.loadFailed', 'Failed to load. Please try again.')}
          </p>
          <button
            onClick={() => void refetch()}
            className="bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-3 px-6 text-sm transition-all duration-150 active:scale-95"
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      )}

      {!isLoading && !isError && allItems.length === 0 && (
        <EmptyState icon="history" message={t('profile.noCheckIns', 'No check-ins yet. Go explore!')} />
      )}

      {!isLoading && !isError && allItems.length > 0 && (
        <div className="flex flex-col gap-3">
          {allItems.map((item) => (
            <div
              key={item.id}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center gap-3"
            >
              {(() => {
                const Icon = CATEGORY_ICONS[item.node.category] ?? MapPin
                return (
                  <Icon
                    size={20}
                    strokeWidth={1.5}
                    className="text-[var(--text-secondary)] shrink-0"
                    aria-hidden="true"
                  />
                )
              })()}
              <div className="flex-1 min-w-0">
                <p className="text-[var(--text-primary)] text-sm font-medium truncate">{item.node.name}</p>
                <p className="text-[var(--text-muted)] text-xs capitalize">{item.node.category}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[var(--text-secondary)] text-xs">{formatDate(item.checkedInAt)}</p>
                <p className="text-[var(--text-muted)] text-xs">{formatTime(item.checkedInAt)}</p>
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
      )}
    </div>
  )
}
