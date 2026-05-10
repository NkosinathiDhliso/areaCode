import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { formatZAR } from '@area-code/shared/lib/formatters'
import { Card } from '@area-code/shared/components/Card'
import { Badge } from '@area-code/shared/components/Badge'

interface BoostROIItem {
  boostId: string
  nodeId: string
  startDate: string
  endDate: string
  durationHours: number
  checkInsDuringBoost: number
  baseline: number
  upliftPercent: number | null
  insufficientData: boolean
  costCents: number
}

export function BoostROIPanel() {
  const { t } = useTranslation()
  const [items, setItems] = useState<BoostROIItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get<{ items: BoostROIItem[] }>('/v1/business/me/boosts/roi')
        setItems(res.items ?? [])
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) {
    return (
      <div className="p-5 flex flex-col gap-4">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">Boost ROI</h2>
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-[var(--bg-raised)] rounded-2xl p-4 animate-shimmer">
            <div className="h-4 w-3/4 bg-[var(--border)] rounded mb-2" />
            <div className="h-3 w-1/2 bg-[var(--border)] rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 flex items-center justify-center py-16">
        <span className="text-[var(--danger)] text-sm">Failed to load boost data. Please try again.</span>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">Boost ROI</h2>
      <p className="text-[var(--text-secondary)] text-sm">
        See how your boosts performed compared to your baseline activity.
      </p>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <span className="text-3xl">📊</span>
          <p className="text-[var(--text-secondary)] text-sm text-center">
            No completed boosts yet. Purchase a boost to see your ROI here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Card key={item.boostId}>
              <div className="flex flex-row items-center justify-between mb-2">
                <span className="text-[var(--text-primary)] text-sm font-medium">
                  {new Date(item.startDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                  {' – '}
                  {new Date(item.endDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-[var(--text-muted)] text-xs">{item.durationHours}h</span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-2">
                <div>
                  <p className="text-[var(--text-muted)] text-xs">Check-ins</p>
                  <p className="text-[var(--text-primary)] text-lg font-bold">{item.checkInsDuringBoost}</p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] text-xs">Uplift</p>
                  {item.insufficientData ? (
                    <p className="text-[var(--warning)] text-xs font-medium mt-1">Insufficient data</p>
                  ) : (
                    <p className={`text-lg font-bold ${(item.upliftPercent ?? 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                      {item.upliftPercent !== null ? `${item.upliftPercent >= 0 ? '+' : ''}${item.upliftPercent.toFixed(0)}%` : '—'}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[var(--text-muted)] text-xs">Cost</p>
                  <p className="text-[var(--text-primary)] text-lg font-bold">{formatZAR(item.costCents / 100)}</p>
                </div>
              </div>

              {!item.insufficientData && (
                <p className="text-[var(--text-muted)] text-xs">
                  Baseline: {item.baseline.toFixed(1)} check-ins (avg of prior 4 weeks)
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
