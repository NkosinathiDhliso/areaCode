import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'

// Operator-facing recent BoosterPurchase view (R6.6 - server already strips
// `tierSnapshot`, `neighbourhoodIdSnapshot`, `floorAtPurchaseCents`). We do
// not import the backend Zod schema here to avoid a backend → frontend
// dependency; the shape is mirrored from the server response contract.
interface BoosterPurchaseView {
  businessId: string
  nodeId: string
  duration: '2hr' | '6hr' | '24hr'
  amountCents: number
  currency: 'ZAR'
  yocoCheckoutId: string
  paidAt: string
}

interface BoostPurchasesResponse {
  items: BoosterPurchaseView[]
  nextCursor: string | null
}

// Format `paidAt` as `YYYY-MM-DD HH:mm` in `Africa/Johannesburg` (R6.5).
// We use `formatToParts` so the assembled string is independent of locale
// punctuation quirks (some locales emit `2024/01/15`, etc.).
function formatPaidAt(iso: string): string {
  const fmt = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

// Format `amountCents` as `R<X>.<YY>` (R6.5). Deliberately not using the
// shared `formatZAR` helper because it strips decimals; the spec wants the
// cent-level precision visible on every row.
function formatAmountCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const fraction = (cents % 100).toString().padStart(2, '0')
  return `R${whole}.${fraction}`
}

export function BoostPurchasesPanel() {
  const { t } = useTranslation()
  const businessId = useBusinessAuthStore((s) => s.businessId)
  const nodes = useBusinessStore((s) => s.nodes)

  const [items, setItems] = useState<BoosterPurchaseView[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchPage(cursor?: string) {
    if (!businessId) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      const qs = params.toString()
      const path = `/v1/business/${businessId}/boost-purchases${qs ? `?${qs}` : ''}`
      const res = await api.get<BoostPurchasesResponse>(path)
      if (cursor) {
        setItems((prev) => [...prev, ...res.items])
      } else {
        setItems(res.items)
      }
      setNextCursor(res.nextCursor)
    } catch {
      setError(t('biz.boost.purchases.loadError', 'Failed to load recent purchases.'))
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (businessId) void fetchPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  // Resolve `nodeId` to the human-readable node name via the existing
  // nodes lookup (R6.5). Falls back to the raw id if the node is not in
  // the cached store (e.g. an old purchase for a since-deleted node).
  function nodeName(nodeId: string): string {
    return nodes.find((n) => n.id === nodeId)?.name ?? nodeId
  }

  return (
    <div className="flex flex-col gap-3 mt-4">
      <h3 className="text-[var(--text-primary)] font-bold text-base font-[Syne]">
        {t('biz.boost.purchases.title', 'Recent purchases')}
      </h3>

      {!loaded && loading && (
        <div className="text-[var(--text-muted)] text-sm">{t('common.loading', 'Loading...')}</div>
      )}

      {/* R6.8 - empty-state copy when the response has zero items. */}
      {loaded && !error && items.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm">
          {t('biz.boost.purchases.empty', 'No booster purchases yet.')}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((row) => (
            <div
              key={`${row.paidAt}#${row.yocoCheckoutId}`}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-row items-center justify-between"
            >
              <div className="flex flex-col gap-1">
                <span className="text-[var(--text-primary)] font-medium text-sm">{nodeName(row.nodeId)}</span>
                <div className="flex flex-row items-center gap-2 text-[var(--text-muted)] text-xs">
                  <span>{formatPaidAt(row.paidAt)}</span>
                  <span>·</span>
                  <span>{row.duration}</span>
                </div>
              </div>
              <span className="text-[var(--accent)] font-bold text-sm">{formatAmountCents(row.amountCents)}</span>
            </div>
          ))}
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={() => fetchPage(nextCursor)}
          disabled={loading}
          className="text-[var(--accent)] text-sm font-medium py-2"
        >
          {loading ? t('common.loading', 'Loading...') : t('biz.boost.purchases.loadMore', 'Load more')}
        </button>
      )}

      {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
    </div>
  )
}
