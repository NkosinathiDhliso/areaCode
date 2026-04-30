import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'

interface DashboardMetrics {
  totalConsumers: number
  totalBusinesses: number
  totalCheckInsAllTime: number
  totalCheckInsToday: number
  activeRewards: number
  pendingReports: number
  pendingErasures: number
  unreviewedAbuseFlags: number
}

export function DashboardOverview() {
  const { t } = useTranslation()
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchMetrics() {
    try {
      const res = await api.get<DashboardMetrics>('/v1/admin/dashboard')
      setMetrics(res)
    } catch {
      // Fail silently
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 60000)
    return () => clearInterval(interval)
  }, [])

  if (loading && !metrics) {
    return (
      <div className="p-5 text-[var(--text-muted)] text-sm text-center py-12">
        Loading dashboard...
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="p-5 text-[var(--text-muted)] text-sm text-center py-12">
        Failed to load dashboard metrics
      </div>
    )
  }

  const cards: Array<{ label: string; value: number; color: string; badge?: boolean }> = [
    { label: 'Total Consumers', value: metrics.totalConsumers, color: 'var(--accent)' },
    { label: 'Total Businesses', value: metrics.totalBusinesses, color: 'var(--accent)' },
    { label: 'Check-Ins (All Time)', value: metrics.totalCheckInsAllTime, color: 'var(--success)' },
    { label: 'Check-Ins (Today)', value: metrics.totalCheckInsToday, color: 'var(--success)' },
    { label: 'Active Rewards', value: metrics.activeRewards, color: 'var(--warning)' },
    { label: 'Pending Reports', value: metrics.pendingReports, color: 'var(--danger)', badge: metrics.pendingReports > 0 },
    { label: 'Pending Erasures', value: metrics.pendingErasures, color: 'var(--danger)', badge: metrics.pendingErasures > 0 },
    { label: 'Unreviewed Abuse Flags', value: metrics.unreviewedAbuseFlags, color: 'var(--danger)', badge: metrics.unreviewedAbuseFlags > 0 },
  ]

  return (
    <div className="p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl mb-4 font-[Syne]">
        {t('admin.dashboard.title', 'Dashboard Overview')}
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col items-center gap-2 relative"
          >
            {card.badge && (
              <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[var(--danger)]" />
            )}
            <span
              className="text-3xl font-bold font-[Syne]"
              style={{ color: card.color }}
            >
              {card.value.toLocaleString()}
            </span>
            <span className="text-[var(--text-muted)] text-xs text-center">
              {card.label}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[var(--text-muted)] text-xs mt-4 text-center">
        Auto-refreshes every 60 seconds
      </p>
    </div>
  )
}
