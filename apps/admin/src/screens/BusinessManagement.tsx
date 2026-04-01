import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { BusinessAccount } from '@area-code/shared/types'

interface BusinessDetail extends BusinessAccount {
  staffCount: number
  nodeCount: number
  activeRewardCount: number
}

export function BusinessManagement() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BusinessDetail[]>([])
  const [selected, setSelected] = useState<BusinessDetail | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await api.get<{ items: BusinessDetail[] }>(
        `/v1/admin/businesses?q=${encodeURIComponent(query)}`,
      )
      setResults(res.items)
    } catch {
      // Fail silently
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(action: string, businessId: string) {
    try {
      await api.post(`/v1/admin/businesses/${businessId}/${action}`)
      handleSearch()
    } catch {
      // Fail silently
    }
  }

  return (
    <div className="p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl mb-4 font-[Syne]">
        {t('admin.businesses.title')}
      </h2>

      <div className="flex flex-row gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search by name or email"
          className="flex-1 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 text-sm"
        >
          Search
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {results.map((biz) => (
          <div
            key={biz.id}
            onClick={() => setSelected(selected?.id === biz.id ? null : biz)}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 cursor-pointer"
          >
            <div className="flex flex-row items-center justify-between">
              <span className="text-[var(--text-primary)] font-medium">{biz.businessName}</span>
              <span className="text-[var(--text-muted)] text-xs capitalize">{biz.tier}</span>
            </div>
            <div className="text-[var(--text-secondary)] text-xs mt-1">
              {biz.email} · {biz.nodeCount} nodes · {biz.staffCount} staff · {biz.activeRewardCount} gets
            </div>

            {selected?.id === biz.id && (
              <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-row flex-wrap gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleAction('extend-trial', biz.id) }}
                  className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs"
                >
                  {t('admin.businesses.extendTrial')}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAction('deactivate-rewards', biz.id) }}
                  className="border border-[var(--danger)] text-[var(--danger)] rounded-xl px-3 py-1.5 text-xs"
                >
                  {t('admin.businesses.deactivateRewards')}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAction('override-cipc', biz.id) }}
                  className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs"
                >
                  {t('admin.businesses.overrideCipc')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
