import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { MusicInsightsSection } from '../../components/MusicInsightsSection'

interface AudienceData {
  tierDistribution: Record<string, number>
  repeatVsNew: { repeat: number; new: number }
  totalUniqueVisitors: number
}

export function AudiencePanel() {
  const { t } = useTranslation()
  const [data, setData] = useState<AudienceData | null>(null)

  useEffect(() => {
    async function fetch() {
      try {
        const res = await api.get<AudienceData>('/v1/business/me/audience')
        setData(res)
      } catch {
        // Fail silently
      }
    }
    fetch()
  }, [])

  if (!data || data.totalUniqueVisitors < 20) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-4">
        <span className="text-[var(--text-muted)] text-sm text-center">
          {t('biz.audience.minUsers')}
        </span>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('biz.audience.title')}
      </h2>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Tier Distribution</h3>
        {Object.entries(data.tierDistribution).map(([tier, count]) => (
          <div key={tier} className="flex flex-row items-center justify-between py-1">
            <span className="text-[var(--text-primary)] text-sm capitalize">{tier}</span>
            <span className="text-[var(--text-muted)] text-sm">{count}</span>
          </div>
        ))}
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Visitors</h3>
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
      </div>

      <MusicInsightsSection />
    </div>
  )
}
