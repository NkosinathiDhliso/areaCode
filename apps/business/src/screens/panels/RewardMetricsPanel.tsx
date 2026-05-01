import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'

interface RewardMetrics {
  claimRate: number
  timeToClaimMinutes: number
  redemptionRate: number
}

interface RewardSummaryItem {
  rewardId: string
  title: string
  claimRate: number
  timeToClaimMinutes: number
  redemptionRate: number
  isLowPerformance: boolean
}

export function RewardMetricsPanel() {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<RewardSummaryItem[]>([])
  const [selectedReward, setSelectedReward] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<RewardMetrics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function fetchSummary() {
      setLoading(true)
      try {
        const res = await api.get<{ items: RewardSummaryItem[] }>('/v1/business/rewards/summary')
        setSummary(res.items)
      } catch {
        // Fail silently
      } finally {
        setLoading(false)
      }
    }
    fetchSummary()
  }, [])

  async function fetchMetrics(rewardId: string) {
    setSelectedReward(rewardId)
    try {
      const res = await api.get<RewardMetrics>(`/v1/business/rewards/${rewardId}/metrics`)
      setMetrics(res)
    } catch {
      setMetrics(null)
    }
  }

  function formatPercent(rate: number): string {
    return `${Math.round(rate * 100)}%`
  }

  function formatTime(minutes: number): string {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('biz.panel.rewardMetrics', 'Reward Metrics')}
      </h2>

      {loading && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">Loading...</div>
      )}

      {!loading && summary.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">
          No active rewards to show metrics for
        </div>
      )}

      {/* Summary comparison table */}
      {summary.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-[var(--border)] text-[var(--text-muted)] text-xs font-medium">
            <span>Reward</span>
            <span className="text-center">Claim Rate</span>
            <span className="text-center">Time to Claim</span>
            <span className="text-center">Redemption</span>
          </div>
          {summary.map((item) => (
            <button
              key={item.rewardId}
              onClick={() => fetchMetrics(item.rewardId)}
              className={`grid grid-cols-4 gap-2 px-4 py-3 w-full text-left border-b border-[var(--border)] last:border-b-0 transition-colors ${
                selectedReward === item.rewardId ? 'bg-[var(--bg-raised)]' : ''
              }`}
            >
              <span className="text-[var(--text-primary)] text-sm font-medium flex items-center gap-1">
                {item.isLowPerformance && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Low performance"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                )}
                {item.title}
              </span>
              <span className="text-[var(--text-secondary)] text-sm text-center">
                {formatPercent(item.claimRate)}
              </span>
              <span className="text-[var(--text-secondary)] text-sm text-center">
                {item.timeToClaimMinutes > 0 ? formatTime(item.timeToClaimMinutes) : '—'}
              </span>
              <span className="text-[var(--text-secondary)] text-sm text-center">
                {formatPercent(item.redemptionRate)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Per-reward detail card */}
      {selectedReward && metrics && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5">
          <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-4">
            {summary.find((s) => s.rewardId === selectedReward)?.title ?? 'Reward'} — Details
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <MetricCard
              label="Claim Rate"
              value={formatPercent(metrics.claimRate)}
              color="var(--accent)"
            />
            <MetricCard
              label="Time to Claim"
              value={metrics.timeToClaimMinutes > 0 ? formatTime(metrics.timeToClaimMinutes) : '—'}
              color="var(--warning)"
            />
            <MetricCard
              label="Redemption Rate"
              value={formatPercent(metrics.redemptionRate)}
              color="var(--success)"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-3 rounded-xl bg-[var(--bg-raised)]">
      <span className="text-2xl font-bold font-[Syne]" style={{ color }}>
        {value}
      </span>
      <span className="text-[var(--text-muted)] text-xs text-center">{label}</span>
    </div>
  )
}
