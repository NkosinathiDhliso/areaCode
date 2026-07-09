import { api } from '@area-code/shared/lib/api'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

/* ------------------------------------------------------------------ */
/*  Types matching the backend DigestView (business service)          */
/*  The copy strings are the single source of truth for the sentences */
/*  and the tier close: the card renders them, it never re-derives     */
/*  copy in the client (design: one source of truth).                  */
/* ------------------------------------------------------------------ */

export type DigestMetricName =
  | 'visits'
  | 'uniqueVisitors'
  | 'firstTimeVisitors'
  | 'returningVisitors'
  | 'redemptions'
  | 'firstGetIssued'
  | 'firstGetConversions'

export interface DigestMetrics {
  visits: number
  uniqueVisitors: number
  firstTimeVisitors: number
  returningVisitors: number
  redemptions: number
  firstGetIssued: number
  firstGetConversions: number
  busiestDay: string | null
  busiestHour: number | null
}

export interface DigestView {
  weekStart: string
  metrics: DigestMetrics
  deltas: Partial<Record<DigestMetricName, number>> | null
  suppressed: DigestMetricName[]
  tierAtBuild: string
  copy: string[]
  createdAt: string
}

interface DigestLatestResponse {
  digest: DigestView | null
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

export function formatWeekStart(iso: string): string {
  // weekStart is a plain ISO date (opening Monday). Render it as a readable
  // South African date without inventing a timezone shift.
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A signed, honest delta chip label, e.g. "+5" / "-3". Absent when the delta
 *  is zero or missing (no chip rather than a "0" that reads as a claim). */
function deltaLabel(delta: number | undefined): string | null {
  if (delta === undefined || delta === 0) return null
  return delta > 0 ? `+${delta}` : `${delta}`
}

/* ------------------------------------------------------------------ */
/*  Metric figure (headline number + short chrome label)              */
/* ------------------------------------------------------------------ */

function MetricFigure({
  value,
  label,
  delta,
  testId,
}: {
  value: number
  label: string
  delta?: number | undefined
  testId: string
}) {
  const chip = deltaLabel(delta)
  const up = (delta ?? 0) > 0
  return (
    <div
      data-testid={testId}
      className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl p-3 flex flex-col items-center gap-1"
    >
      <div className="flex flex-row items-baseline gap-1.5">
        <span className="text-[var(--text-primary)] text-2xl font-bold font-[Syne]">{value}</span>
        {chip && (
          <span
            className="text-xs font-medium"
            style={{ color: up ? 'var(--success, #22c55e)' : 'var(--text-secondary)' }}
          >
            {chip}
          </span>
        )}
      </div>
      <span className="text-[var(--text-muted)] text-xs text-center">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  DigestCard                                                        */
/* ------------------------------------------------------------------ */

export function DigestCard() {
  const { t } = useTranslation()

  const { data, isLoading, error } = useQuery({
    queryKey: ['business', 'digest', 'latest'],
    queryFn: () => api.get<DigestLatestResponse>('/v1/business/digest/latest'),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div
        data-testid="digest-card-loading"
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5"
      >
        <span className="text-[var(--text-muted)] text-sm">{t('biz.digest.loading', 'Loading your digest…')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div
        data-testid="digest-card-error"
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5"
      >
        <span className="text-[var(--danger)] text-sm">
          {t('biz.digest.error', "Couldn't load your digest. Please try again.")}
        </span>
      </div>
    )
  }

  const digest = data?.digest ?? null

  // Honest empty state: a business with no closed Digest_Week yet has nothing
  // to show. This is not an error, it is a clean "not yet" message.
  if (!digest) {
    return (
      <div
        data-testid="digest-card-empty"
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-1.5"
      >
        <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          {t('biz.digest.empty.title', 'No digest yet')}
        </h3>
        <p className="text-[var(--text-secondary)] text-sm">
          {t('biz.digest.empty.body', 'Your first weekly digest arrives after your next full week on Area Code.')}
        </p>
      </div>
    )
  }

  const { metrics, deltas, copy } = digest
  const isQuietWeek = metrics.visits === 0

  // The API copy array is the one source of truth for the sentences and the
  // tier close. The last line is the tier-aware close; render it visually apart
  // but never re-derive or rewrite any of it in the client.
  const closeLine = copy.length > 0 ? copy[copy.length - 1] : null
  const bodyLines = copy.slice(0, Math.max(copy.length - 1, 0))

  return (
    <div
      data-testid="digest-card"
      className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex flex-row items-center justify-between">
        <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          {t('biz.digest.title', 'Weekly digest')}
        </h3>
        <span className="text-[var(--text-muted)] text-xs">
          {t('biz.digest.weekOf', 'Week of')} {formatWeekStart(digest.weekStart)}
        </span>
      </div>

      {isQuietWeek && (
        <span
          data-testid="digest-quiet-week"
          className="self-start text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--bg-raised)] text-[var(--text-secondary)]"
        >
          {t('biz.digest.quietWeek', 'Quiet week')}
        </span>
      )}

      {/* Headline metric figures. Absolute counts always render; a quiet week
          shows an honest zero, never a fabricated number. */}
      <div className="grid grid-cols-2 gap-3">
        <MetricFigure
          testId="digest-metric-visits"
          value={metrics.visits}
          label={t('biz.digest.metric.visits', 'Visits recorded')}
          delta={deltas?.visits}
        />
        <MetricFigure
          testId="digest-metric-unique"
          value={metrics.uniqueVisitors}
          label={t('biz.digest.metric.uniqueVisitors', 'Unique visitors')}
          delta={deltas?.uniqueVisitors}
        />
        <MetricFigure
          testId="digest-metric-firsttimers"
          value={metrics.firstTimeVisitors}
          label={t('biz.digest.metric.firstTimeVisitors', 'First-time visitors')}
          delta={deltas?.firstTimeVisitors}
        />
        <MetricFigure
          testId="digest-metric-conversions"
          value={metrics.firstGetConversions}
          label={t('biz.digest.metric.firstGetConversions', 'First-Get conversions')}
          delta={deltas?.firstGetConversions}
        />
      </div>

      {/* Digest sentences: rendered verbatim from the API copy strings. */}
      {bodyLines.length > 0 && (
        <div data-testid="digest-copy" className="flex flex-col gap-2">
          {bodyLines.map((line, i) => (
            <p key={i} className="text-[var(--text-primary)] text-sm leading-relaxed">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Tier-aware close, the last API copy line. */}
      {closeLine && (
        <p
          data-testid="digest-close"
          className="text-[var(--text-secondary)] text-sm leading-relaxed border-t border-[var(--border)] pt-3"
        >
          {closeLine}
        </p>
      )}
    </div>
  )
}
