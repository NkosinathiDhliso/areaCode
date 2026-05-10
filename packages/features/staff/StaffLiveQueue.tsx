/**
 * Staff Live Queue UI — displays incoming check-in cards and today's stats bar.
 *
 * Requirements: 4.2, 4.3, 4.4
 */
import { useTranslation } from 'react-i18next'

import { Badge } from '../../shared/components/Badge'
import { useStaffStore } from '../../shared/stores/staffStore'
import { formatRelativeTime } from '../../shared/lib/formatters'
import type { BadgePulseState } from '../../shared/components/Badge'
import type { Tier } from '../../shared/types'

const tierToBadgeTier: Record<Tier, 'local' | 'regular' | 'fixture' | 'institution' | 'legend'> = {
  local: 'local',
  regular: 'regular',
  fixture: 'fixture',
  institution: 'institution',
  legend: 'legend',
}

export function StaffLiveQueue() {
  const { t } = useTranslation()
  const liveQueue = useStaffStore((s) => s.liveQueue)
  const todayStats = useStaffStore((s) => s.todayStats)
  const wsStatus = useStaffStore((s) => s.wsStatus)

  return (
    <div className="flex flex-col gap-4 px-5 pt-4">
      {/* Today's Stats Bar */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center">
            <span className="text-[var(--text-primary)] font-bold text-lg">{todayStats.checkIns}</span>
            <span className="text-[var(--text-muted)] text-xs">{t('staff.checkIns', 'Check-ins')}</span>
          </div>
          <div className="w-px h-8 bg-[var(--border)]" />
          <div className="flex flex-col items-center">
            <span className="text-[var(--text-primary)] font-bold text-lg">{todayStats.redemptions}</span>
            <span className="text-[var(--text-muted)] text-xs">{t('staff.redemptions', 'Redemptions')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="pulse-state"
            label={todayStats.pulseState}
            pulseState={todayStats.pulseState as BadgePulseState}
          />
          {wsStatus !== 'connected' && (
            <span className="w-2 h-2 rounded-full bg-[var(--warning)] animate-pulse" title="Reconnecting..." />
          )}
        </div>
      </div>

      {/* Live Queue Header */}
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">
          {t('staff.liveQueue', 'Live Queue')}
        </span>
        <span className="text-[var(--text-muted)] text-xs">
          {liveQueue.length} / 20
        </span>
      </div>

      {/* Check-in Cards */}
      {liveQueue.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2">
          <span className="text-[var(--text-muted)] text-sm">
            {t('staff.noCheckIns', 'No check-ins yet today')}
          </span>
          <span className="text-[var(--text-muted)] text-xs">
            {t('staff.waitingForCheckIns', 'Waiting for customers...')}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
          {liveQueue.map((event) => (
            <div
              key={event.id}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center justify-between transition-all duration-200"
            >
              <div className="flex items-center gap-3">
                <span className="text-[var(--text-primary)] text-sm font-medium">
                  {event.consumerName}
                </span>
                <Badge
                  variant="tier"
                  label={event.tier}
                  tier={tierToBadgeTier[event.tier]}
                />
              </div>
              <span className="text-[var(--text-muted)] text-xs">
                {formatRelativeTime(event.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
