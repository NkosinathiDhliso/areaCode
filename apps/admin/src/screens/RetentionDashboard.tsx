import { api } from '@area-code/shared/lib/api'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CohortRow {
  cohortWeekStart: string
  signups: number
  d1: number
  d7: number
  d30: number
  d90: number
  d1Pct: number
  d7Pct: number
  d30Pct: number
  d90Pct: number
}

interface VenueLeak {
  nodeId: string
  nodeName: string
  signupsAttributed: number
  d7ReturnCount: number
  d7ReturnPct: number
}

interface RetentionPayload {
  cohorts: CohortRow[]
  topLeakingVenues: VenueLeak[]
  generatedAt: string
  cacheMinutes: number
}

const WEEKS_OPTIONS = [4, 8, 12, 26] as const

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function formatWeek(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

/**
 * Heat-map style cell. Lower retention = warmer colour. The thresholds
 * are calibrated to South African early-stage loyalty norms — a Day-7
 * return rate above 35% is genuinely good, below 15% is a leak.
 */
function HeatCell({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value))
  const tone =
    v >= 0.35
      ? 'bg-[var(--success)]/15 text-[var(--success)]'
      : v >= 0.2
        ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
        : v >= 0.1
          ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
          : 'bg-[var(--danger)]/20 text-[var(--danger)]'
  return (
    <span className={`inline-block min-w-[3.5rem] text-center px-2 py-0.5 rounded-md text-xs font-medium ${tone}`}>
      {pct(value)}
    </span>
  )
}

export function RetentionDashboard() {
  const { t } = useTranslation()
  const [weeks, setWeeks] = useState<number>(12)
  const [data, setData] = useState<RetentionPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function fetchRetention(w: number) {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await api.get<RetentionPayload>(`/v1/admin/retention?weeks=${w}`)
      setData(res)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchRetention(weeks)
  }, [weeks])

  const totals = useMemo(() => {
    if (!data) return null
    const t = data.cohorts.reduce(
      (acc, c) => {
        acc.signups += c.signups
        acc.d1 += c.d1
        acc.d7 += c.d7
        acc.d30 += c.d30
        acc.d90 += c.d90
        return acc
      },
      { signups: 0, d1: 0, d7: 0, d30: 0, d90: 0 },
    )
    return {
      ...t,
      d1Pct: t.signups ? t.d1 / t.signups : 0,
      d7Pct: t.signups ? t.d7 / t.signups : 0,
      d30Pct: t.signups ? t.d30 / t.signups : 0,
      d90Pct: t.signups ? t.d90 / t.signups : 0,
    }
  }, [data])

  return (
    <div className="p-5 flex flex-col gap-5">
      <div className="flex flex-row items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
            {t('admin.retention.title', 'Retention')}
          </h2>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            {t(
              'admin.retention.subtitle',
              'Where new users go after signup. Below 15% on Day 7 means you have a leak.',
            )}
          </p>
        </div>
        <div className="flex flex-row items-center gap-2">
          {WEEKS_OPTIONS.map((w) => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={`px-3 py-1.5 rounded-xl text-xs transition-all duration-150 ${
                w === weeks
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)]'
              }`}
            >
              {w}w
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <div className="text-[var(--text-muted)] text-sm text-center py-12">Loading retention…</div>}

      {loadError && !data && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-[var(--text-muted)] text-sm">Failed to load retention data</p>
          <button onClick={() => void fetchRetention(weeks)} className="text-[var(--accent)] text-sm">
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Headline retention summary */}
          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryCard label="Signups" value={totals.signups.toLocaleString()} />
              <SummaryCard label="Day 1" value={pct(totals.d1Pct)} tone={totals.d1Pct} />
              <SummaryCard label="Day 7" value={pct(totals.d7Pct)} tone={totals.d7Pct} />
              <SummaryCard label="Day 30" value={pct(totals.d30Pct)} tone={totals.d30Pct} />
              <SummaryCard label="Day 90" value={pct(totals.d90Pct)} tone={totals.d90Pct} />
            </div>
          )}

          {/* Cohort table */}
          <section>
            <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-3">
              By signup week (most recent first)
            </h3>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] text-xs uppercase tracking-wide">
                    <th className="py-2 pr-4">Week</th>
                    <th className="py-2 pr-4 text-right">Signups</th>
                    <th className="py-2 pr-4 text-right">D1</th>
                    <th className="py-2 pr-4 text-right">D7</th>
                    <th className="py-2 pr-4 text-right">D30</th>
                    <th className="py-2 text-right">D90</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[var(--text-muted)] text-xs">
                        No signups in this window
                      </td>
                    </tr>
                  )}
                  {data.cohorts.map((c) => (
                    <tr key={c.cohortWeekStart} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-4 text-[var(--text-primary)] font-mono text-xs">
                        {formatWeek(c.cohortWeekStart)}
                      </td>
                      <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{c.signups}</td>
                      <td className="py-2 pr-4 text-right">
                        <HeatCell value={c.d1Pct} />
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <HeatCell value={c.d7Pct} />
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <HeatCell value={c.d30Pct} />
                      </td>
                      <td className="py-2 text-right">
                        <HeatCell value={c.d90Pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Leaking venues */}
          <section>
            <div className="flex flex-row items-center justify-between mb-3">
              <h3 className="text-[var(--text-primary)] font-semibold text-sm">Top leaking venues</h3>
              <span className="text-[var(--text-muted)] text-xs">By Day-7 return rate (worst first)</span>
            </div>
            {data.topLeakingVenues.length === 0 ? (
              <p className="text-[var(--text-muted)] text-xs py-4">
                Not enough signups attributed to any single venue to surface leaks. Try a wider window.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.topLeakingVenues.map((v) => (
                  <li
                    key={v.nodeId}
                    className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-row items-center justify-between gap-3"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-[var(--text-primary)] text-sm truncate">{v.nodeName}</span>
                      <span className="text-[var(--text-muted)] text-xs">
                        {v.signupsAttributed} acquired · {v.d7ReturnCount} returned within 7 days
                      </span>
                    </div>
                    <HeatCell value={v.d7ReturnPct} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-[var(--text-muted)] text-xs text-center">
            Cached for {data.cacheMinutes} min · Generated {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const colour =
    tone === undefined
      ? 'var(--accent)'
      : tone >= 0.35
        ? 'var(--success)'
        : tone >= 0.2
          ? 'var(--warning)'
          : 'var(--danger)'
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col items-center gap-1">
      <span className="text-2xl font-bold font-[Syne]" style={{ color: colour }}>
        {value}
      </span>
      <span className="text-[var(--text-muted)] text-xs">{label}</span>
    </div>
  )
}
