import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { formatZAR } from '@area-code/shared/lib/formatters'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'

interface BoostPricing {
  '2hr': number
  '6hr': number
  '24hr': number
}

export function BoostPanel() {
  const { t } = useTranslation()
  const [pricing, setPricing] = useState<BoostPricing | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nodes = useBusinessStore((s) => s.nodes)

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get<{ boost: BoostPricing }>('/v1/business/plans')
        setPricing(res.boost)
      } catch {
        setError(t('biz.boost.loadError', 'Failed to load boost pricing. Please refresh.'))
      }
    }
    void load()
  }, [t])

  async function handleBoost(duration: '2hr' | '6hr' | '24hr') {
    const nodeId = nodes[0]?.id
    if (!nodeId) {
      setError(t('biz.boost.noNode', 'No node found. Please create a node first.'))
      return
    }
    setLoading(duration)
    setError(null)
    try {
      const res = await api.post<{ checkoutUrl: string }>('/v1/business/boost', {
        nodeId,
        duration,
      })
      window.location.href = res.checkoutUrl
    } catch {
      setError(t('biz.boost.error', 'Failed to start boost. Please try again.'))
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
                {formatZAR(pricing[dur] / 100)}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-[var(--danger)] text-xs mt-2">{error}</p>}
    </div>
  )
}
