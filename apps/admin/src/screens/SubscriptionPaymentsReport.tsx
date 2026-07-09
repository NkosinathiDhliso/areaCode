import { api } from '@area-code/shared/lib/api'
import type { ApiError } from '@area-code/shared/lib/api'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

// ─── Types (mirrored from backend response contract) ───────────────────────
//
// Mirror of `SubscriptionPaymentView` from
// `backend/src/features/business/types.ts`. The admin frontend has no
// `backend/` dependency so the shape is duplicated here. The view is already
// PII-free: business identifiers and amounts only (R8.2).

type SubscriptionPlan = 'growth' | 'pro' | 'payg'

type PaidInterval = 'monthly' | 'yearly' | 'daily' | 'weekly'

interface SubscriptionPaymentView {
  businessId: string
  plan: SubscriptionPlan
  interval: PaidInterval
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

const PAGE_LIMIT = 25

// Format `cents` as `R<X>.<YY>` - same convention used across the booster and
// subscription surfaces so admins read amounts consistently (R7.6).
function formatAmountCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const fraction = (cents % 100).toString().padStart(2, '0')
  return `R${whole}.${fraction}`
}

// Format an ISO 8601 timestamp as `YYYY-MM-DD HH:mm` in `Africa/Johannesburg`
// (same SA-time convention as the admin boost report).
function formatTimestamp(iso: string): string {
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

function isApiError(e: unknown): e is ApiError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    'statusCode' in e &&
    typeof (e as { statusCode: unknown }).statusCode === 'number'
  )
}

// `<input type="date">` returns the local-calendar `YYYY-MM-DD` string. We
// build inclusive-day ISO timestamps in UTC (the gsi1sk is millisecond-precision
// UTC, so widening to the full UTC day keeps SA-time results visible without a
// timezone library). Mirrors the admin boost report.
function dateInputToIsoStartOfDay(date: string): string {
  return `${date}T00:00:00.000Z`
}

function dateInputToIsoEndOfDay(date: string): string {
  return `${date}T23:59:59.999Z`
}

function todayDateInput(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysAgoDateInput(days: number): string {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function SubscriptionPaymentsReport() {
  const { t } = useTranslation()

  const defaultFrom = useMemo(() => daysAgoDateInput(30), [])
  const defaultTo = useMemo(() => todayDateInput(), [])

  const [fromDate, setFromDate] = useState<string>(defaultFrom)
  const [toDate, setToDate] = useState<string>(defaultTo)
  const [dateRangeError, setDateRangeError] = useState<string | null>(null)

  const [items, setItems] = useState<SubscriptionPaymentView[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function runDateRangeQuery(cursor?: string) {
    setLoading(true)
    setDateRangeError(null)
    setEmptyMessage(null)
    if (!cursor) setSearched(true)
    try {
      const params = new URLSearchParams()
      params.set('from', dateInputToIsoStartOfDay(fromDate))
      params.set('to', dateInputToIsoEndOfDay(toDate))
      if (cursor) params.set('cursor', cursor)
      const res = await api.get<SubscriptionPaymentsResponse>(`/v1/admin/subscription-payments?${params.toString()}`)
      if (cursor) {
        setItems((prev) => [...prev, ...res.items])
      } else {
        setItems(res.items)
        if (res.items.length === 0) {
          setEmptyMessage('No subscription payments in this date range.')
        }
      }
      setNextCursor(res.nextCursor)
    } catch (err) {
      // Surface 400s inline so the admin understands the cap. Server returns
      // INVALID_DATE_RANGE for `from > to` and for ranges over 367 days, plus
      // INVALID_QUERY / INVALID_CURSOR for other issues. 5xx is already toasted
      // by the shared API client.
      if (isApiError(err) && err.statusCode === 400) {
        setDateRangeError(err.message || 'Invalid date range')
        if (!cursor) {
          setItems([])
          setNextCursor(null)
        }
      } else if (isApiError(err)) {
        setDateRangeError(err.message || 'Failed to load subscription payments')
      } else {
        setDateRangeError('Failed to load subscription payments')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleDateRangeSubmit(e: React.FormEvent) {
    e.preventDefault()
    void runDateRangeQuery()
  }

  async function handleCopy(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev))
      }, 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts (e.g. a self-hosted
      // staging build over HTTP). The admin can still select the id manually.
    }
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <div>
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('admin.subscriptionPayments.title', 'Subscription Payments')}
        </h2>
        <p className="text-[var(--text-muted)] text-xs mt-1">
          {t(
            'admin.subscriptionPayments.subtitle',
            'Cross-business subscription payment audit log for refund, dispute, and revenue reconciliation. Search by date range.',
          )}
        </p>
      </div>

      {/* ─── Date-range form ─────────────────────────────────────────── */}
      <form
        onSubmit={handleDateRangeSubmit}
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3 max-w-md"
      >
        <h3 className="text-[var(--text-primary)] font-bold text-sm font-[Syne]">Search by date range</h3>
        <div className="flex flex-row gap-3">
          <label className="flex flex-col gap-1 flex-1">
            <span className="text-[var(--text-secondary)] text-xs">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={loading}
              className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 flex-1">
            <span className="text-[var(--text-secondary)] text-xs">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={loading}
              className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-[var(--accent)] text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        {dateRangeError && <p className="text-[var(--danger)] text-xs">{dateRangeError}</p>}
        <p className="text-[var(--text-muted)] text-[10px]">
          Maximum range is 367 days. Times are inclusive of full UTC days.
        </p>
      </form>

      {/* ─── Results table ─────────────────────────────────────────────── */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-raised)]">
              <tr className="text-left text-[var(--text-secondary)]">
                <th className="px-3 py-2 font-semibold">paidAt</th>
                <th className="px-3 py-2 font-semibold">businessId</th>
                <th className="px-3 py-2 font-semibold">plan</th>
                <th className="px-3 py-2 font-semibold">interval</th>
                <th className="px-3 py-2 font-semibold text-right">amount</th>
                <th className="px-3 py-2 font-semibold">paidUntilProduced</th>
                <th className="px-3 py-2 font-semibold">yocoCheckoutId</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)] italic">
                    {emptyMessage ?? (searched ? 'No results.' : 'Run a query to see subscription payments.')}
                  </td>
                </tr>
              )}
              {items.map((row) => (
                <tr
                  key={`${row.yocoCheckoutId}#${row.paidAt}`}
                  className="border-t border-[var(--border)] text-[var(--text-primary)]"
                >
                  <td className="px-3 py-2 whitespace-nowrap" title={row.paidAt}>
                    {formatTimestamp(row.paidAt)}
                  </td>
                  <td className="px-3 py-2 font-mono">{row.businessId}</td>
                  <td className="px-3 py-2">{row.plan}</td>
                  <td className="px-3 py-2 font-mono">{row.interval}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatAmountCents(row.amountCents)}</td>
                  <td className="px-3 py-2 whitespace-nowrap" title={row.paidUntilProduced}>
                    {formatTimestamp(row.paidUntilProduced)}
                  </td>
                  <td className="px-3 py-2 font-mono break-all max-w-[18ch]">{row.yocoCheckoutId}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void handleCopy(row.yocoCheckoutId)}
                      className="text-[var(--accent)] text-xs font-medium px-2 py-1 rounded-lg border border-[var(--border)]"
                    >
                      {copiedId === row.yocoCheckoutId ? 'Copied' : 'Copy'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="border-t border-[var(--border)] px-3 py-2 flex justify-center">
            <button
              type="button"
              onClick={() => void runDateRangeQuery(nextCursor)}
              disabled={loading}
              className="text-[var(--accent)] text-xs font-medium py-1"
            >
              {loading ? 'Loading…' : `Load more (${PAGE_LIMIT} per page)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
