import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'

import { api } from '@area-code/shared/lib/api'

/* ------------------------------------------------------------------ */
/*  Types matching backend Report / TeaserReport                      */
/* ------------------------------------------------------------------ */

interface ReportSummary {
  totalCheckIns: number
  pulseState: string
  topGenre: string | null
  headlineRecommendation: string
}

interface PeakHoursResult {
  hourlyDistribution: Record<string, number>
  dailyDistribution: Record<string, number>
  topWindows: Array<{ startHour: number; endHour: number; count: number }>
  peakDay: string
}

interface CrowdCompositionResult {
  tierPercentages: Record<string, number>
  tierUniqueCounts: Record<string, number>
  totalUniqueVisitors: number
}

interface MusicProfileResult {
  archetypeDimensions: Record<string, number>
  topGenres: Array<{ genre: string; visitorCount: number }>
  hasInsufficientData: boolean
}

interface TrendDelta {
  current: number
  previous: number
  percentChange: number
  direction: 'up' | 'down' | 'flat'
}

interface TrendResult {
  metrics: Record<string, TrendDelta>
  hasPriorData: boolean
}

interface JourneyResult {
  topOverlapVenues: Array<{
    venueName: string
    overlapPercentage: number
    overlapCount: number
  }>
  partnershipSuggestions: string[]
  hasInsufficientData: boolean
}

interface RecommendationResult {
  recommendations: Array<{
    type: 'peak_hours' | 'music' | 'retention' | 'benchmark' | 'general'
    text: string
  }>
}

interface FullReport {
  reportId: string
  businessId: string
  schemaVersion: string
  periodType: 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  generatedAt: string
  summary: ReportSummary
  peakHours: PeakHoursResult
  crowdComposition: CrowdCompositionResult
  musicProfile: MusicProfileResult | null
  repeatVisitors: { repeatRate: number; firstTimeVisitorCount: number; totalUniqueVisitors: number }
  trends: TrendResult
  benchmarks: {
    metrics: Record<string, { venueValue: number; benchmarkAverage: number; percentAboveBelow: number }>
    hasInsufficientData: boolean
  } | null
  journeyInsights: JourneyResult | null
  recommendations: RecommendationResult
}

interface TeaserReport {
  reportId: string
  businessId: string
  schemaVersion: string
  periodType: 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  generatedAt: string
  summary: ReportSummary
  upgradeMessage: string
}

type ReportResponse = FullReport | TeaserReport

interface ReportListItem {
  reportId: string
  periodType: 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  generatedAt: string
  totalCheckIns: number
}

interface ReportListResponse {
  reports: ReportListItem[]
  cursor?: string
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function isTeaser(report: ReportResponse): report is TeaserReport {
  return 'upgradeMessage' in report
}

function directionIcon(dir: 'up' | 'down' | 'flat') {
  if (dir === 'up') return '↑'
  if (dir === 'down') return '↓'
  return '-'
}

function directionColor(dir: 'up' | 'down' | 'flat') {
  if (dir === 'up') return 'var(--success, #22c55e)'
  if (dir === 'down') return 'var(--danger, #ef4444)'
  return 'var(--text-muted)'
}

const DONUT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899']

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

/* ------------------------------------------------------------------ */
/*  Chart sub-components                                              */
/* ------------------------------------------------------------------ */

function PeakHoursChart({ data }: { data: PeakHoursResult }) {
  const chartData = useMemo(() => {
    return Array.from({ length: 24 }, (_, h) => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      count: data.hourlyDistribution[String(h)] ?? data.hourlyDistribution[h] ?? 0,
    }))
  }, [data.hourlyDistribution])

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Peak Hours</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData}>
          <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} interval={3} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="var(--accent)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[var(--text-muted)] text-xs mt-2">
        Peak day: <span className="text-[var(--text-primary)] font-medium">{data.peakDay}</span>
      </p>
    </div>
  )
}

function CrowdCompositionChart({ data }: { data: CrowdCompositionResult }) {
  const chartData = useMemo(() => {
    return Object.entries(data.tierPercentages).map(([tier, pct]) => ({
      name: tier.charAt(0).toUpperCase() + tier.slice(1),
      value: Math.round(pct * 10) / 10,
    }))
  }, [data.tierPercentages])

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Crowd Composition</h3>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            dataKey="value"
            nameKey="name"
            label={({ name, value }) => `${name} ${value}%`}
            labelLine={false}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <p className="text-[var(--text-muted)] text-xs mt-2">
        Total unique visitors:{' '}
        <span className="text-[var(--text-primary)] font-medium">{data.totalUniqueVisitors}</span>
      </p>
    </div>
  )
}

function MusicProfileChart({ data }: { data: MusicProfileResult }) {
  const chartData = useMemo(() => {
    return Object.entries(data.archetypeDimensions).map(([dim, score]) => ({
      dimension: dim.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      score: Math.round(score * 100) / 100,
    }))
  }, [data.archetypeDimensions])

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Music Profile</h3>
      <ResponsiveContainer width="100%" height={250}>
        <RadarChart data={chartData}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
          <PolarRadiusAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
          <Radar dataKey="score" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
      {data.topGenres.length > 0 && (
        <div className="mt-3">
          <p className="text-[var(--text-muted)] text-xs mb-1">Top genres:</p>
          <div className="flex flex-wrap gap-1">
            {data.topGenres.map((g) => (
              <span
                key={g.genre}
                className="px-2 py-0.5 rounded-full bg-[var(--bg-raised)] text-[var(--text-secondary)] text-xs"
              >
                {g.genre} ({g.visitorCount})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main ReportsPanel                                                 */
/* ------------------------------------------------------------------ */

export function ReportsPanel() {
  const { t } = useTranslation()
  const [periodFilter, setPeriodFilter] = useState<'weekly' | 'monthly'>('weekly')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Fetch report list
  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: ['business', 'reports', periodFilter],
    queryFn: () => api.get<ReportListResponse>(`/v1/business/me/reports?period=${periodFilter}`),
    staleTime: 60_000,
  })

  const reports = listData?.reports ?? []
  const currentReportId = reports[selectedIndex]?.reportId

  // On-demand report generation
  const queryClient = useQueryClient()
  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<
        | { generated: true; reportId: string }
        | { generated: false; reason: 'no_nodes' | 'no_check_ins' | 'pii'; message: string }
      >('/v1/business/me/reports/generate', { periodType: periodFilter }),
    onSuccess: (res) => {
      if (res.generated) {
        void queryClient.invalidateQueries({ queryKey: ['business', 'reports', periodFilter] })
        setSelectedIndex(0)
      }
    },
  })
  const generateBanner =
    generateMutation.data && !generateMutation.data.generated ? generateMutation.data.message : null

  // Fetch selected report detail
  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['business', 'report', currentReportId],
    queryFn: () => api.get<ReportResponse>(`/v1/business/me/reports/${currentReportId}`),
    enabled: !!currentReportId,
    staleTime: 300_000,
  })

  function goPrev() {
    setSelectedIndex((i) => Math.min(i + 1, reports.length - 1))
  }

  function goNext() {
    setSelectedIndex((i) => Math.max(i - 1, 0))
  }

  /* ---- Loading / Error states ---- */

  if (listLoading) {
    return (
      <div className="p-5 flex items-center justify-center h-full">
        <span className="text-[var(--text-muted)] text-sm">Loading reports…</span>
      </div>
    )
  }

  if (listError) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3">
        <span className="text-[var(--danger)] text-sm">Failed to load reports.</span>
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="p-5 flex flex-col gap-4">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.panel.reports')}</h2>
        <PeriodToggle
          value={periodFilter}
          onChange={(v) => {
            setPeriodFilter(v)
            setSelectedIndex(0)
          }}
        />
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <span className="text-[var(--text-muted)] text-sm text-center max-w-[280px]">
            No {periodFilter} reports yet. Generate one now from your recent check-ins.
          </span>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 px-6 text-sm disabled:opacity-50"
          >
            {generateMutation.isPending ? 'Generating…' : `Generate ${periodFilter} report now`}
          </button>
          {generateBanner && (
            <p className="text-[var(--text-secondary)] text-xs text-center max-w-[280px]">{generateBanner}</p>
          )}
          {generateMutation.isError && (
            <p className="text-[var(--danger)] text-xs text-center">Could not generate. Please try again.</p>
          )}
        </div>
      </div>
    )
  }

  const currentListItem = reports[selectedIndex]

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.panel.reports')}</h2>

      {/* Period toggle + on-demand generate */}
      <div className="flex flex-row items-center justify-between gap-2">
        <PeriodToggle
          value={periodFilter}
          onChange={(v) => {
            setPeriodFilter(v)
            setSelectedIndex(0)
          }}
        />
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {generateMutation.isPending ? 'Generating…' : 'Generate now'}
        </button>
      </div>
      {generateBanner && <p className="text-[var(--text-secondary)] text-xs">{generateBanner}</p>}

      {/* Date navigation */}
      {currentListItem && (
        <div className="flex flex-row items-center justify-between">
          <button
            onClick={goPrev}
            disabled={selectedIndex >= reports.length - 1}
            className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] disabled:opacity-30"
            aria-label="Previous report"
          >
            ← Prev
          </button>
          <span className="text-[var(--text-primary)] text-sm font-medium">
            {formatDate(currentListItem.periodStart)} – {formatDate(currentListItem.periodEnd)}
          </span>
          <button
            onClick={goNext}
            disabled={selectedIndex <= 0}
            className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] disabled:opacity-30"
            aria-label="Next report"
          >
            Next →
          </button>
        </div>
      )}

      {/* Report content */}
      {reportLoading && (
        <div className="flex items-center justify-center py-8">
          <span className="text-[var(--text-muted)] text-sm">Loading report…</span>
        </div>
      )}

      {report && isTeaser(report) && <TeaserView report={report} />}
      {report && !isTeaser(report) && <FullReportView report={report} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Period toggle                                                     */
/* ------------------------------------------------------------------ */

function PeriodToggle({
  value,
  onChange,
}: {
  value: 'weekly' | 'monthly'
  onChange: (v: 'weekly' | 'monthly') => void
}) {
  return (
    <div className="flex flex-row gap-1 bg-[var(--bg-raised)] rounded-xl p-1 self-start">
      {(['weekly', 'monthly'] as const).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
            p === value
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Teaser view (starter/payg tiers)                                  */
/* ------------------------------------------------------------------ */

function TeaserView({ report }: { report: TeaserReport }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <SummaryCards summary={report.summary} />

      {/* Blurred placeholders */}
      <div className="relative">
        <div className="flex flex-col gap-4 filter blur-sm pointer-events-none select-none" aria-hidden="true">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 h-48" />
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 h-48" />
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 h-32" />
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-base)]/60 rounded-2xl">
          <span className="text-[var(--text-primary)] font-semibold text-center px-6">{report.upgradeMessage}</span>
          <span className="text-[var(--accent)] text-sm font-medium">Upgrade to Growth →</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Full report view                                                  */
/* ------------------------------------------------------------------ */

function FullReportView({ report }: { report: FullReport }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <SummaryCards summary={report.summary} />

      {/* Trend comparisons */}
      {report.trends.hasPriorData && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
          <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Trends</h3>
          <div className="flex flex-col gap-2">
            {Object.entries(report.trends.metrics).map(([key, delta]) => (
              <div key={key} className="flex flex-row items-center justify-between">
                <span className="text-[var(--text-primary)] text-sm capitalize">
                  {key
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/_/g, ' ')
                    .trim()}
                </span>
                <span className="text-sm font-medium" style={{ color: directionColor(delta.direction) }}>
                  {directionIcon(delta.direction)} {Math.abs(Math.round(delta.percentChange))}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts - conditionally rendered based on data availability */}
      {report.peakHours && <PeakHoursChart data={report.peakHours} />}
      {report.crowdComposition && <CrowdCompositionChart data={report.crowdComposition} />}
      {report.musicProfile && !report.musicProfile.hasInsufficientData && (
        <MusicProfileChart data={report.musicProfile} />
      )}

      {/* Recommendations */}
      {report.recommendations.recommendations.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
          <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Recommendations</h3>
          <ol className="flex flex-col gap-2">
            {report.recommendations.recommendations.map((rec, i) => (
              <li key={i} className="flex flex-row items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--bg-raised)] flex items-center justify-center text-xs text-[var(--text-secondary)] flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-[var(--text-primary)] text-sm">{rec.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Journey insights */}
      {report.journeyInsights && !report.journeyInsights.hasInsufficientData && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
          <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Journey Insights</h3>
          {report.journeyInsights.topOverlapVenues.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              <p className="text-[var(--text-muted)] text-xs">Your visitors also check in at:</p>
              {report.journeyInsights.topOverlapVenues.map((v) => (
                <div key={v.venueName} className="flex flex-row items-center justify-between">
                  <span className="text-[var(--text-primary)] text-sm">{v.venueName}</span>
                  <span className="text-[var(--text-muted)] text-sm">{Math.round(v.overlapPercentage)}% overlap</span>
                </div>
              ))}
            </div>
          )}
          {report.journeyInsights.partnershipSuggestions.length > 0 && (
            <div className="border-t border-[var(--border)] pt-3">
              <p className="text-[var(--text-muted)] text-xs mb-1">Partnership opportunities:</p>
              {report.journeyInsights.partnershipSuggestions.map((s, i) => (
                <p key={i} className="text-[var(--text-primary)] text-sm">
                  • {s}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Summary cards (shared between teaser and full)                    */
/* ------------------------------------------------------------------ */

function SummaryCards({ summary }: { summary: ReportSummary }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-col items-center gap-1">
        <span className="text-[var(--text-primary)] text-2xl font-bold font-[Syne]">{summary.totalCheckIns}</span>
        <span className="text-[var(--text-muted)] text-xs">Check-ins</span>
      </div>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-col items-center gap-1">
        <span className="text-[var(--text-primary)] text-lg font-semibold capitalize">{summary.pulseState}</span>
        <span className="text-[var(--text-muted)] text-xs">Pulse</span>
      </div>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-col items-center gap-1">
        <span className="text-[var(--text-primary)] text-sm font-medium truncate w-full text-center">
          {summary.topGenre ?? '-'}
        </span>
        <span className="text-[var(--text-muted)] text-xs">Top Genre</span>
      </div>
    </div>
  )
}
