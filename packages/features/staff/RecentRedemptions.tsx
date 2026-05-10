/**
 * Recent Redemptions list — last 50, filterable by status.
 * Shows code, reward title, timestamp, and status.
 *
 * Requirements: 5.6
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../shared/components/Badge'
import { useStaffStore } from '../../shared/stores/staffStore'
import { formatRelativeTime } from '../../shared/lib/formatters'
import type { StaffRedemptionRecord } from '../../shared/stores/staffStore'

type StatusFilter = 'all' | 'success' | 'failed'

export function RecentRedemptions() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const recentRedemptions = useStaffStore((s) => s.recentRedemptions)

  const filtered: StaffRedemptionRecord[] =
    filter === 'all'
      ? recentRedemptions
      : recentRedemptions.filter((r) => r.status === filter)

  return (
    <div className="flex-1 overflow-y-auto px-5 pt-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">
          {t('staff.recentRedemptions', 'Recent Redemptions')}
        </span>
        <span className="text-[var(--text-muted)] text-xs">
          {filtered.length} / {recentRedemptions.length}
        </span>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-3">
        {(['all', 'success', 'failed'] as StatusFilter[]).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 active:scale-95 ${
              filter === status
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-raised)] text-[var(--text-secondary)]'
            }`}
            aria-label={`Filter by ${status}`}
          >
            {status === 'all'
              ? t('staff.filterAll', 'All')
              : status === 'success'
                ? t('staff.filterSuccess', 'Success')
                : t('staff.filterFailed', 'Failed')}
          </button>
        ))}
      </div>

      {/* Redemption list */}
      {filtered.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm py-4">
          {t('staff.noRedemptions', 'No redemptions yet')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center justify-between"
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-[var(--text-primary)] text-sm font-medium truncate">
                  {r.rewardTitle}
                </span>
                <span className="text-[var(--text-muted)] font-mono text-xs truncate">
                  {r.code.slice(0, 8)}...{r.code.slice(-4)}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <Badge
                  variant="status"
                  label={r.status === 'success' ? 'Success' : 'Failed'}
                  status={r.status === 'success' ? 'success' : 'error'}
                />
                <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">
                  {formatRelativeTime(r.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
