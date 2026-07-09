import { EmptyState } from '@area-code/shared/components/EmptyState'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { useNotifications } from '@area-code/shared/hooks'
import type { NotificationItem } from '@area-code/shared/stores'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppRoute } from '../types'

interface NotificationCenterProps {
  onNavigate: (route: AppRoute) => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (Number.isNaN(diff)) return ''
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function NotificationCenter({ onNavigate }: NotificationCenterProps) {
  const { t } = useTranslation()
  const { items, isPending, error, hasMore, loadMore, isLoadingMore, markAllRead } = useNotifications()

  // Mark everything read on open (Req 24.3). Runs once after the first load.
  useEffect(() => {
    if (!isPending && items.length > 0) {
      void markAllRead()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending])

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      <div className="flex flex-row items-center justify-between mb-4">
        <div className="flex flex-row items-center gap-3">
          <button
            onClick={() => onNavigate('profile')}
            aria-label={t('common.back', 'Back')}
            className="text-[var(--text-muted)] transition-all active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('notif.center.title')}</h1>
        </div>
        <button
          onClick={() => onNavigate('notification-settings')}
          className="text-[var(--accent)] text-sm font-medium"
        >
          {t('notif.center.settings')}
        </button>
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      ) : error ? (
        <p className="text-[var(--text-secondary)] text-sm text-center mt-8">{t('notif.center.loadFailed')}</p>
      ) : items.length === 0 ? (
        <EmptyState icon="inbox" message={t('notif.center.empty')} />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n: NotificationItem) => (
            <div
              key={n.notifId}
              className={`rounded-2xl px-4 py-3 border ${
                n.isRead
                  ? 'bg-[var(--bg-surface)] border-[var(--border)]'
                  : 'bg-[var(--bg-raised)] border-[var(--accent)]/40'
              }`}
            >
              <div className="flex flex-row items-start justify-between gap-3">
                <p className="text-[var(--text-primary)] text-sm font-medium">{n.title}</p>
                <span className="text-[var(--text-muted)] text-[11px] shrink-0">{timeAgo(n.createdAt)}</span>
              </div>
              {n.body ? <p className="text-[var(--text-secondary)] text-xs mt-1">{n.body}</p> : null}
            </div>
          ))}

          {hasMore && (
            <button
              onClick={() => void loadMore()}
              disabled={isLoadingMore}
              className="mt-2 text-[var(--accent)] text-sm font-medium py-2 disabled:opacity-50"
            >
              {isLoadingMore ? '…' : t('notif.center.loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
