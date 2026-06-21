import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { ApiError } from '@area-code/shared/lib/api'

// ─── Types (mirrored from backend response contract) ───────────────────────
//
// Mirror of `AdminBoosterPurchaseView` from
// `backend/src/features/business/types.ts`. The admin frontend has no
// `backend/` dependency so the shape is duplicated here. Do not add any
// phone/SMS field per `.kiro/steering/no-sms-no-phone-auth.md`.

type BoostDuration = '2hr' | '6hr' | '24hr'

type BoostTierSnapshot = 'starter' | 'growth' | 'pro' | 'payg'

interface AdminBoosterPurchaseView {
  businessId: string
  nodeId: string
  duration: BoostDuration
  amountCents: number
  currency: 'ZAR'
  yocoCheckoutId: string
  paidAt: string
  tierSnapshot: BoostTierSnapshot
  neighbourhoodIdSnapshot: string | null
  floorAtPurchaseCents: number
}

interface BoostPurchasesResponse {
  items: AdminBoosterPurchaseView[]
  nextCursor: string | null
}

const PAGE_LIMIT = 25

// Format `cents` as `R<X>.<YY>` - same convention used in BoostFloorEditor and
// the operator BoostPurchasesPanel so admins read amounts consistently across
// the platform (R7.6).
function formatAmountCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const fraction = (cents % 100).toString().padStart(2, '0')
  return `R${whole}.${fraction}`
}

// Format an ISO 8601 timestamp as `YYYY-MM-DD HH:mm` in `Africa/Johannesburg`
// (R6.5 convention; reused here for the admin report so timestamps are SA-time
// across all booster surfaces).
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
// build inclusive-day ISO timestamps in UTC (R7.2 expects an ISO range and
// the gsi1sk is millisecond-precision UTC, so widening to the full UTC day
// keeps SA-time results visible without a timezone library).
function dateInputToIsoStartOfDay(date: string): string {
  return `${date}T00:00:00.000Z`
}

function dateInputToIsoEndOfDay(date: string): string {
  return `${date}T23:59:59.999Z`
}

function todayDateInput(): string {
  // YYYY-MM-DD in local time. The exact local-vs-UTC offset doesn't matter
  // here - the admin is picking a calendar day and we widen to the full UTC
  // day on submit anyway.
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

export function BoostPurchaseReport() {
  const { t } = useTranslation()

  // Mutually-exclusive query mode. `null` means no query has been issued yet
  // and the table renders a hint row. Each submit replaces the active mode
  // and clears the other form's results.
  const [mode, setMode] = useState<'date-range' | 'yoco-checkout' | null>(null)

  const defaultFrom = useMemo(() => daysAgoDateInput(7), [])
  const defaultTo = useMemo(() => todayDateInput(), [])

  const [fromDate, setFromDate] = useState<string>(defaultFrom)
  const [toDate, setToDate] = useState<string>(defaultTo)
  const [dateRangeError, setDateRangeError] = useState<string | null>(null)

  const [yocoCheckoutId, setYocoCheckoutId] = useState<string>('')
  const [yocoLookupError, setYocoLookupError] = useState<string | null>(null)

  const [items, setItems] = useState<AdminBoosterPurchaseView[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function runDateRangeQuery(cursor?: string) {
    setLoading(true)
    setDateRangeError(null)
    setYocoLookupError(null)
    setEmptyMessage(null)
    if (!cursor) setMode('date-range')
    try {
      const params = new URLSearchParams()
      params.set('from', dateInputToIsoStartOfDay(fromDate))
      params.set('to', dateInputToIsoEndOfDay(toDate))
      if (cursor) params.set('cursor', cursor)
      const res = await api.get<BoostPurchasesResponse>(`/v1/admin/boost-purchases?${params.toString()}`)
      if (cursor) {
        setItems((prev) => [...prev, ...res.items])
      } else {
        setItems(res.items)
        if (res.items.length === 0) {
          setEmptyMessage('No purchases in this date range.')
        }
      }
      setNextCursor(res.nextCursor)
    } catch (err) {
      // Surface 400s inline so the admin understands the cap (R7.5). Server
      // returns INVALID_DATE_RANGE for `from > to` and for ranges over
      // 367 days, plus INVALID_QUERY / INVALID_CURSOR for other issues. 5xx
      // is already toasted by the shared API client.
      if (isApiError(err) && err.statusCode === 400) {
        setDateRangeError(err.message || 'Invalid date range')
        if (!cursor) {
          setItems([])
          setNextCursor(null)
        }
      } else if (isApiError(err)) {
        setDateRangeError(err.message || 'Failed to load purchases')
      } else {
        setDateRangeError('Failed to load purchases')
      }
    } finally {
      setLoading(false)
    }
  }

  async function runYocoLookup() {
    setLoading(true)
    setDateRangeError(null)
    setYocoLookupError(null)
    setEmptyMessage(null)
    setMode('yoco-checkout')
    try {
      const params = new URLSearchParams()
      params.set('yocoCheckoutId', yocoCheckoutId.trim())
      const res = await api.get<BoostPurchasesResponse>(`/v1/admin/boost-purchases?${params.toString()}`)
      setItems(res.items)
      setNextCursor(null)
      if (res.items.length === 0) {
        setEmptyMessage('No purchase found for this checkout id.')
      }
    } catch (err) {
      if (isApiError(err)) {
        setYocoLookupError(err.message || 'Failed to look up checkout')
      } else {
        setYocoLookupError('Failed to look up checkout')
      }
      setItems([])
      setNextCursor(null)
    } finally {
      setLoading(false)
    }
  }

  function handleDateRangeSubmit(e: React.FormEvent) {
    e.preventDefault()
    void runDateRangeQuery()
  }

  function handleYocoSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (yocoCheckoutId.trim().length === 0) {
      setYocoLookupError('Enter a Yoco checkout id')
      return
    }
    void runYocoLookup()
  }

  async function handleCopy(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      // Reset the visual confirmation after a beat so a second copy of the
      // same id is still acknowledged.
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev))
      }, 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts (e.g. a self-hosted
      // staging build over HTTP). Fall back to a no-op - the admin can
      // still triple-click the cell to select the id manually.
    }
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <div>
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('admin.boostPurchases.title', 'Booster Purchases')}
        </h2>
        <p className="text-[var(--text-muted)] text-xs mt-1">
          {t(
            'admin.boostPurchases.subtitle',
            'Cross-business booster purchase audit log for refund and dispute support. Search by date range or by Yoco checkout id.',
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ─── Date-range form ─────────────────────────────────────── */}
        <form
          onSubmit={handleDateRangeSubmit}
          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3"
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
            {loading && mode === 'date-range' ? 'Searching…' : 'Search'}
          </button>
          {dateRangeError && <p className="text-[var(--danger)] text-xs">{dateRangeError}</p>}
          <p className="text-[var(--text-muted)] text-[10px]">
            Maximum range is 367 days. Times are inclusive of full UTC days.
          </p>
        </form>

        {/* ─── yocoCheckoutId lookup form ────────────────────────────── */}
        <form
          onSubmit={handleYocoSubmit}
          className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3"
        >
          <h3 className="text-[var(--text-primary)] font-bold text-sm font-[Syne]">Look up by Yoco checkout id</h3>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--text-secondary)] text-xs">Yoco checkout id</span>
            <input
              type="text"
              value={yocoCheckoutId}
              onChange={(e) => setYocoCheckoutId(e.target.value)}
              disabled={loading}
              placeholder="ch_..."
              className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] font-mono"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="bg-[var(--accent)] text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading && mode === 'yoco-checkout' ? 'Looking up…' : 'Look up'}
          </button>
          {yocoLookupError && <p className="text-[var(--danger)] text-xs">{yocoLookupError}</p>}
        </form>
      </div>

      {/* ─── Results table ─────────────────────────────────────────── */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-raised)]">
              <tr className="text-left text-[var(--text-secondary)]">
                <th className="px-3 py-2 font-semibold">paidAt</th>
                <th className="px-3 py-2 font-semibold">businessId</th>
                <th className="px-3 py-2 font-semibold">nodeId</th>
                <th className="px-3 py-2 font-semibold">duration</th>
                <th className="px-3 py-2 font-semibold text-right">amount</th>
                <th className="px-3 py-2 font-semibold">tier</th>
                <th className="px-3 py-2 font-semibold">neighbourhoodId</th>
                <th className="px-3 py-2 font-semibold text-right">floorAtPurchase</th>
                <th className="px-3 py-2 font-semibold">yocoCheckoutId</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-[var(--text-muted)] italic">
                    {emptyMessage ?? 'Run a query to see purchases.'}
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
                  <td className="px-3 py-2 font-mono">{row.nodeId}</td>
                  <td className="px-3 py-2 font-mono">{row.duration}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatAmountCents(row.amountCents)}</td>
                  <td className="px-3 py-2">{row.tierSnapshot}</td>
                  <td className="px-3 py-2 font-mono">{row.neighbourhoodIdSnapshot ?? '-'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {formatAmountCents(row.floorAtPurchaseCents)}
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

        {mode === 'date-range' && nextCursor && (
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
