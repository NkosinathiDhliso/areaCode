import { api } from '@area-code/shared/lib/api'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatWeekStart, type DigestView } from './DigestCard'

/* ------------------------------------------------------------------ */
/*  Digest history: a simple reverse-chronological list of prior       */
/*  digests, sitting behind the latest-week DigestCard. The backend    */
/*  (GET /v1/business/digest/history) returns items newest first with  */
/*  opaque cursor pagination; this view renders them in that order and */
/*  loads older weeks on demand. Each row renders the API copy strings */
/*  verbatim, the one source of truth for the sentences (design: no    */
/*  copy re-derivation in the client).                                 */
/* ------------------------------------------------------------------ */

interface DigestHistoryResponse {
  items: DigestView[]
  nextCursor: string | null
}

function HistoryRow({ digest }: { digest: DigestView }) {
  const { t } = useTranslation()
  const { metrics, copy } = digest
  return (
    <div
      data-testid="digest-history-row"
      className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-2"
    >
      <div className="flex flex-row items-center justify-between gap-2">
        <span className="text-[var(--text-primary)] text-sm font-semibold">{formatWeekStart(digest.weekStart)}</span>
        <span className="text-[var(--text-muted)] text-xs">
          {metrics.visits} {t('biz.digest.metric.visits', 'Visits recorded')}
        </span>
      </div>
      {copy.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {copy.map((line, i) => (
            <p key={i} className="text-[var(--text-secondary)] text-sm leading-relaxed">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function DigestHistory() {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } = useInfiniteQuery({
    queryKey: ['business', 'digest', 'history'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('cursor', pageParam)
      const qs = params.toString()
      return api.get<DigestHistoryResponse>(`/v1/business/digest/history${qs ? `?${qs}` : ''}`)
    },
    initialPageParam: undefined as string | undefined,
    // nextCursor is null on the last page; map that to undefined so react-query
    // stops paginating (hasNextPage becomes false).
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: expanded,
    staleTime: 60_000,
  })

  const items = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="digest-history-panel"
        data-testid="digest-history-toggle"
        className="self-start min-h-[44px] px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-sm font-medium active:scale-95 transition-transform"
      >
        {expanded ? t('biz.digest.history.hide', 'Hide prior weeks') : t('biz.digest.history.show', 'View prior weeks')}
      </button>

      {expanded && (
        <div id="digest-history-panel" data-testid="digest-history-panel" className="flex flex-col gap-3">
          {isLoading && (
            <span data-testid="digest-history-loading" className="text-[var(--text-muted)] text-sm">
              {t('biz.digest.history.loading', 'Loading prior weeks…')}
            </span>
          )}

          {error && (
            <span data-testid="digest-history-error" className="text-[var(--danger)] text-sm">
              {t('biz.digest.history.error', "Couldn't load prior weeks. Please try again.")}
            </span>
          )}

          {!isLoading && !error && items.length === 0 && (
            <span data-testid="digest-history-empty" className="text-[var(--text-secondary)] text-sm">
              {t('biz.digest.history.empty', 'No prior weeks yet. Your digest history builds up week by week.')}
            </span>
          )}

          {items.map((digest) => (
            <HistoryRow key={digest.weekStart} digest={digest} />
          ))}

          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              data-testid="digest-history-load-more"
              className="self-start min-h-[44px] px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-sm font-medium disabled:opacity-60 active:scale-95 transition-transform"
            >
              {isFetchingNextPage
                ? t('biz.digest.history.loadingMore', 'Loading…')
                : t('biz.digest.history.loadMore', 'Load more')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
