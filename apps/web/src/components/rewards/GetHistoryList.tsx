import { timeAgo } from '../../lib/timeAgo'

import type { ClaimedGet } from './types'

/**
 * The viewer's own claimed-and-used get history, newest first. Complements the
 * wallet of active codes by showing what they have already redeemed — proof the
 * gets habit is paying off.
 */
export function GetHistoryList({ history, t }: { history: ClaimedGet[]; t: (k: string) => string }) {
  if (history.length === 0) return null

  return (
    <div className="mt-8">
      <h2 className="text-[var(--text-primary)] font-bold text-base font-[Syne] mb-3">{t('rewards.getHistory')}</h2>
      <div className="flex flex-col gap-2">
        {history.map((h) => (
          <div
            key={h.id}
            className="flex items-center justify-between gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[var(--text-primary)] text-sm font-medium truncate">{h.rewardTitle}</p>
              <p className="text-[var(--text-secondary)] text-xs mt-0.5 truncate">{h.nodeName}</p>
            </div>
            <span className="shrink-0 text-[var(--text-muted)] text-[11px]">{timeAgo(h.redeemedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
