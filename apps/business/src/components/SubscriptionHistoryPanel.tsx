import { api } from '@area-code/shared/lib/api'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Operator-facing recent Subscription_Payment_Row view (R7.5). The server
// projects each row to this shape (business identifiers and amounts only, no
// PII). We do not import the backend Zod schema here to avoid a backend →
// frontend dependency; the shape is mirrored from the server response contract.
interface SubscriptionPaymentView {
  businessId: string
  plan: 'growth' | 'pro' | 'payg'
  interval: 'monthly' | 'yearly' | 'daily' | 'weekly'
  amountCents: number
  currency: 'ZAR'
  yocoCheckoutId: string
  paidAt: string
  paidUntilProduced: string
}

interface SubscriptionPaymentsResponse {
  items: SubscriptionPaymentView[]
  nextCursor: string | null
}

// Format `paidAt` as `YYYY-MM-DD HH:mm` in `Africa/Johannesburg` (R7.5).
// We use `formatToParts` so the assembled string is independent of locale
// punctuation quirks (some locales emit `2024/01/15`, etc.). Mirrors the
// BoostPurchasesPanel helper.
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

// Format `paidUntilProduced` as `YYYY-MM-DD` (date only) in
// `Africa/Johannesburg` (R7.5). The window end is a calendar date to the
// operator, so the time component is not shown.
function formatDate(iso: string): string {
  const fmt = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Format `amountCents` as `R<X>.<YY>` (R7.5). Deliberately not using the
// shared `formatZAR` helper because it strips decimals; the spec wants the
// cent-level precision visible on every row. Mirrors the BoostPurchasesPanel
// helper.
function formatAmountCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const fraction = (cents % 100).toString().padStart(2, '0')
  return `R${whole}.${fraction}`
}

export function SubscriptionHistoryPanel() {
  const { t } = useTranslation()
  const businessId = useBusinessAuthStore((s) => s.businessId)

  const [items, setItems] = useState<SubscriptionPaymentView[]>([])
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
      // Business-scope endpoint (task 8.2): businessId is resolved from the
      // auth context, so there is no path-level businessId here.
      const path = `/v1/business/subscription-payments${qs ? `?${qs}` : ''}`
      const res = await api.get<SubscriptionPaymentsResponse>(path)
      if (cursor) {
        setItems((prev) => [...prev, ...res.items])
      } else {
        setItems(res.items)
      }
      setNextCursor(res.nextCursor)
    } catch {
      setError(t('biz.subscription.payments.loadError', 'Failed to load subscription payments.'))
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (businessId) void fetchPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  return (
    <div className="flex flex-col gap-3 mt-4">
      <h3 className="text-[var(--text-primary)] font-bold text-base font-[Syne]">
        {t('biz.subscription.payments.title', 'Subscription payments')}
      </h3>

      {!loaded && loading && (
        <div className="text-[var(--text-muted)] text-sm">{t('common.loading', 'Loading...')}</div>
      )}

      {/* Empty-state copy when the response has zero items. */}
      {loaded && !error && items.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm">
          {t('biz.subscription.payments.empty', 'No subscription payments yet.')}
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
                <span className="text-[var(--text-primary)] font-medium text-sm capitalize">
                  {row.plan} · {row.interval}
                </span>
                <div className="flex flex-row items-center gap-2 text-[var(--text-muted)] text-xs">
                  <span>{formatPaidAt(row.paidAt)}</span>
                  <span>·</span>
                  <span>
                    {t('biz.subscription.payments.paidUntil', 'Paid until')} {formatDate(row.paidUntilProduced)}
                  </span>
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
          {loading ? t('common.loading', 'Loading...') : t('biz.subscription.payments.loadMore', 'Load more')}
        </button>
      )}

      {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
    </div>
  )
}
