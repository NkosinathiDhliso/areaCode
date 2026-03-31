import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { formatZAR } from '@area-code/shared/lib/formatters'

interface BoostPricing {
  '2hr': number
  '6hr': number
  '24hr': number
}

export function BoostPanel() {
  const { t } = useTranslation()
  const [pricing, setPricing] = useState<BoostPricing | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    async function fetch() {
      try {
        const res = await api.get<{ boost: BoostPricing }>('/v1/business/plans')
        setPricing(res.boost)
      } catch {
        // Fail silently
      }
    }
    fetch()
  }, [])

  async function handleBoost(duration: '2hr' | '6hr' | '24hr') {
    setLoading(duration)
    try {
      const res = await api.post<{ checkoutUrl: string }>('/v1/business/boost', {
        nodeId: 'current-node-id',
        duration,
      })
      window.location.href = res.checkoutUrl
    } catch {
      // Fail silently
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('biz.boost.title')}
      </h2>

      {pricing && (
        <div className="flex flex-col gap-3">
          {(['2hr', '6hr', '24hr'] as const).map((dur) => (
            <button
              key={dur}
              onClick={() => handleBoost(dur)}
              disabled={loading !== null}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-row items-center justify-between active:scale-[0.98] transition-transform"
            >
              <div>
                <span className="text-[var(--text-primary)] font-medium">{dur} Boost</span>
              </div>
              <span className="text-[var(--accent)] font-bold">
                {formatZAR(pricing[dur])}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
