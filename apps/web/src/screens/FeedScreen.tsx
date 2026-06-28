import { Skeleton } from '@area-code/shared/components/Skeleton'
import { api } from '@area-code/shared/lib/api'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { FeedItemRow } from '../components/FeedItemRow'
import { resolveArchetypeDisplayName } from '../lib/archetypeDisplay'
import {
  filterArchetypeCluster,
  filterLiveGets,
  sortFeedItems,
  type EnrichedFeedItem,
  type RawFeedItem,
} from '../lib/feedEnrichment'
import { getNodeState } from '../lib/mapHelpers'
import type { AppRoute } from '../types'

interface FeedResponse {
  items: RawFeedItem[]
  nextCursor: string | null
  hasMore: boolean
}

interface NearbyReward {
  id: string
  title: string
  nodeId: string
  nodeName: string
  getCategory?: 'loyalty' | 'event' | 'offer'
  lifecycle?: 'upcoming' | 'live' | 'ended'
}

const DEFAULT_LAT = -26.2041
const DEFAULT_LNG = 28.0473

interface FeedScreenProps {
  onNavigate: (route: AppRoute) => void
}

/** Live vibe snapshot the feed enriches each item from (R11.1, R11.2). */
interface EnrichContext {
  pulseScores: Record<string, number>
  checkInCounts: Record<string, number>
  archetypeIds: Record<string, string>
  friendsAtVenue: Record<string, string[]>
  defaultArchetypeOf: (nodeId: string) => string | null
  isKnown: (nodeId: string) => boolean
}

/**
 * Enrich a raw check-in with current venue vibe from the live store. Pulse
 * state is null when no live data exists for the venue, so we never claim a
 * stale state (honest presence, R11.1.3).
 */
function enrichCheckin(item: RawFeedItem, ctx: EnrichContext): EnrichedFeedItem {
  const nodeId = item.node?.id ?? ''
  const venuePulseState = ctx.isKnown(nodeId) ? getNodeState(ctx.pulseScores[nodeId] ?? 0) : null
  return {
    id: item.id,
    feedType: 'checkin',
    checkedInAt: item.checkedInAt,
    user: item.user,
    node: item.node,
    venuePulseState,
    venueCheckInCount: ctx.checkInCounts[nodeId] ?? 0,
    venueArchetypeId: ctx.archetypeIds[nodeId] ?? ctx.defaultArchetypeOf(nodeId),
    friendStillPresent: item.user ? (ctx.friendsAtVenue[nodeId] ?? []).includes(item.user.id) : false,
  }
}

/** Pass a milestone item through unchanged (no venue vibe to enrich). */
function toMilestoneItem(item: RawFeedItem): EnrichedFeedItem {
  return {
    id: item.id,
    feedType: 'milestone',
    checkedInAt: item.checkedInAt,
    venuePulseState: null,
    venueCheckInCount: 0,
    venueArchetypeId: null,
    friendStillPresent: false,
    title: item.title,
    body: item.body,
  }
}

export function FeedScreen({ onNavigate }: FeedScreenProps) {
  const { t } = useTranslation()
  const sentinelRef = useRef<HTMLDivElement>(null)

  const archetypeId = useUserStore((s) => s.user?.archetypeId ?? null)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const checkInCounts = useMapStore((s) => s.checkInCounts)
  const archetypeIds = useMapStore((s) => s.archetypeIds)
  const friendsAtVenue = useMapStore((s) => s.friendsAtVenue)
  const nodes = useMapStore((s) => s.nodes)
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)
  const pos = useLocationStore((s) => s.lastKnownPosition)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ limit: '20' })
      if (pageParam) params.set('cursor', pageParam)
      return api.get<FeedResponse>(`/v1/feed?${params}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    staleTime: 30_000,
  })

  // Live gets near the consumer (R11.4). Shares the near-me query cache.
  const { data: rewards } = useQuery({
    queryKey: ['rewards', 'near-me', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<NearbyReward[]>(`/v1/rewards/near-me?lat=${pos?.lat ?? DEFAULT_LAT}&lng=${pos?.lng ?? DEFAULT_LNG}`),
    staleTime: 30_000,
  })

  const handleFocusVenue = useCallback(
    (nodeId: string) => {
      setFocusNodeId(nodeId)
      onNavigate('map')
    },
    [setFocusNodeId, onNavigate],
  )

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

  const rawItems = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])

  // Enrich, then split into the archetype cluster (pinned) and the main feed.
  const { clusterItems, mainItems } = useMemo(() => {
    const ctx: EnrichContext = {
      pulseScores,
      checkInCounts,
      archetypeIds,
      friendsAtVenue,
      defaultArchetypeOf: (nodeId) => nodes[nodeId]?.defaultArchetypeId ?? null,
      isKnown: (nodeId) => nodes[nodeId] !== undefined || nodeId in pulseScores,
    }
    const enriched = rawItems.map((i) => (i.feedType === 'milestone' ? toMilestoneItem(i) : enrichCheckin(i, ctx)))

    const cluster = filterArchetypeCluster(enriched, archetypeId).slice(0, 5)
    const clusterIds = new Set(cluster.map((i) => i.id))

    const liveGets: EnrichedFeedItem[] = filterLiveGets(rewards ?? []).map((r) => ({
      id: `live-get-${r.id}`,
      feedType: 'live_get',
      checkedInAt: new Date().toISOString(),
      node: { id: r.nodeId, name: r.nodeName, slug: '', category: '' },
      venuePulseState: null,
      venueCheckInCount: 0,
      venueArchetypeId: null,
      friendStillPresent: false,
      getTitle: r.title,
    }))

    const main = sortFeedItems([...enriched.filter((i) => !clusterIds.has(i.id)), ...liveGets])
    return { clusterItems: cluster, mainItems: main }
  }, [rawItems, rewards, archetypeId, pulseScores, checkInCounts, archetypeIds, friendsAtVenue, nodes])

  const clusterLabel = archetypeId
    ? t('feed.clusterLabel', {
        archetype: resolveArchetypeDisplayName(archetypeId).replace(/^The /, ''),
        defaultValue: '{{archetype}}s are out',
      })
    : ''

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-4">{t('feed.title')}</h1>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-[var(--text-muted)] text-sm text-center">
            {t('feed.loadError', "Couldn't load your feed. Check your connection.")}
          </p>
          <button onClick={() => void refetch()} className="text-[var(--accent)] text-sm font-medium">
            {t('common.retry', 'Retry')}
          </button>
        </div>
      ) : mainItems.length > 0 || clusterItems.length > 0 ? (
        <div className="flex flex-col gap-3">
          {/* Archetype cluster pinned at the top (R11.3, R11.6.1). */}
          {clusterItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wide">
                {clusterLabel}
              </h2>
              {clusterItems.map((item) => (
                <FeedItemRow key={`cluster-${item.id}`} item={item} onFocusVenue={handleFocusVenue} />
              ))}
              <div className="border-t border-[var(--border)] mt-1" />
            </section>
          )}

          {mainItems.map((item) => (
            <FeedItemRow key={item.id} item={item} onFocusVenue={handleFocusVenue} />
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
          <Users size={32} strokeWidth={1.5} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-[var(--text-muted)] text-sm text-center max-w-xs">
            {t('feed.emptyState', 'No activity yet | follow friends to fill this up.')}
          </p>
        </div>
      )}
    </div>
  )
}
