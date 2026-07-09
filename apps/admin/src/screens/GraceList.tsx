import { api } from '@area-code/shared/lib/api'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BusinessDetailPanel } from '../components/BusinessDetailPanel'

// Mirror of the backend Grace_List projection
// (cross-portal-lifecycle-alignment R2.2). The admin frontend has no backend
// dependency, so the shape is duplicated here.
interface GraceBusiness {
  businessId: string
  businessName: string
  tier: string
  paymentGraceUntil: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

// Grace_List admin screen (R2.2). Businesses currently in the renewal grace
// window, soonest expiry first, so retention and support can act before a venue
// leaves the map. Each row links into the shared BusinessDetailPanel.
export function GraceList() {
  const { t } = useTranslation()
  const [items, setItems] = useState<GraceBusiness[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailBusinessId, setDetailBusinessId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await api.get<{ items: GraceBusiness[] }>('/v1/admin/businesses/grace')
        if (!cancelled) setItems(res.items)
      } catch {
        if (!cancelled) setError('Failed to load the grace list. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('admin.grace.title', 'Businesses in grace')}
        </h2>
        <p className="text-[var(--text-muted)] text-xs mt-1">
          {t(
            'admin.grace.subtitle',
            'Paid venues whose subscription lapsed and are in the renewal grace window. Soonest to leave the map first.',
          )}
        </p>
      </div>

      {error && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[var(--text-muted)] text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">No businesses are currently in grace.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((biz) => (
            <div
              key={biz.businessId}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-row items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-[var(--text-primary)] font-medium truncate">
                  {biz.businessName || biz.businessId}
                </div>
                <div className="text-[var(--text-secondary)] text-xs mt-1">
                  <span className="capitalize">{biz.tier}</span> · grace ends {formatDate(biz.paymentGraceUntil)} (
                  {daysUntil(biz.paymentGraceUntil)}d left)
                </div>
              </div>
              <button
                onClick={() => setDetailBusinessId(biz.businessId)}
                className="flex-shrink-0 border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs"
              >
                {t('admin.businesses.viewDetails', 'View details')}
              </button>
            </div>
          ))}
        </div>
      )}

      {detailBusinessId && (
        <BusinessDetailPanel businessId={detailBusinessId} onClose={() => setDetailBusinessId(null)} />
      )}
    </div>
  )
}
