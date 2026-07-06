import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { AudienceAnalytics, Tier } from '@area-code/shared/types'
import { getTierLabel } from '@area-code/shared/constants/tier-levels'
import { MusicInsightsSection } from '../../components/MusicInsightsSection'

export function AudiencePanel() {
  const { t } = useTranslation()
  const [data, setData] = useState<AudienceAnalytics | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetch() {
      try {
        const res = await api.get<AudienceAnalytics>('/v1/business/me/audience')
        setData(res)
      } catch {
        setError(true)
      }
    }
    void fetch()
  }, [])

  if (error) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-4">
        <span className="text-[var(--danger)] text-sm text-center">
          {t('errors.loadFailed', 'Failed to load. Please try again.')}
        </span>
        <button
          onClick={() => {
            setError(false)
            window.location.reload()
          }}
          className="text-[var(--accent)] text-sm"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    )
  }

  if (!data || data.totalUniqueVisitors < 20) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-4">
        <span className="text-[var(--text-muted)] text-sm text-center">{t('biz.audience.minUsers')}</span>
      </div>
    )
  }

  const notEnoughData = t('biz.audience.notEnoughData', 'Not enough data yet')

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.audience.title')}</h2>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Tier Distribution</h3>
        {data.tierDistribution ? (
          Object.entries(data.tierDistribution).map(([tier, count]) => (
            <div key={tier} className="flex flex-row items-center justify-between py-1">
              <span className="text-[var(--text-primary)] text-sm">{getTierLabel(tier as Tier)}</span>
              <span className="text-[var(--text-muted)] text-sm">{count}</span>
            </div>
          ))
        ) : (
          <p className="text-[var(--text-muted)] text-sm text-center">{notEnoughData}</p>
        )}
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Visitors</h3>
        {data.repeatVsNew ? (
          <div className="flex flex-row gap-4">
            <div className="flex-1 text-center">
              <span className="text-[var(--text-primary)] text-2xl font-bold">{data.repeatVsNew.repeat}</span>
              <p className="text-[var(--text-muted)] text-xs">Repeat</p>
            </div>
            <div className="flex-1 text-center">
              <span className="text-[var(--text-primary)] text-2xl font-bold">{data.repeatVsNew.new}</span>
              <p className="text-[var(--text-muted)] text-xs">New</p>
            </div>
          </div>
        ) : (
          <p className="text-[var(--text-muted)] text-sm text-center">{notEnoughData}</p>
        )}
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Peak Hours</h3>
        {data.peakHours && data.peakHours.length > 0 ? (
          <div className="flex flex-row flex-wrap gap-2">
            {data.peakHours.map((hour) => (
              <span
                key={hour}
                className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-3 py-2 text-[var(--text-primary)] text-sm"
              >
                {hour}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[var(--text-muted)] text-sm text-center">{notEnoughData}</p>
        )}
      </div>

      <MusicInsightsSection />
    </div>
  )
}
