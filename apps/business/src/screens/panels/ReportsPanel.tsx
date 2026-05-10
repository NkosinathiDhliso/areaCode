import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@area-code/shared/lib/api'
import { PeakHoursChart, CrowdCompositionChart, MusicProfileChart, SummaryCards, TeaserView, FullReportView } from './ReportViews'

/* ------------------------------------------------------------------ */
/*  Types matching backend Report / TeaserReport                      */
/* ------------------------------------------------------------------ */

export interface ReportSummary {
  totalCheckIns: number
  pulseState: string
  topGenre: string | null
  headlineRecommendation: string
}

export interface PeakHoursResult {
  hourlyDistribution: Record<string, number>
  dailyDistribution: Record<string, number>
  topWindows: Array<{ startHour: number; endHour: number; count: number }>
  peakDay: string
}

export interface CrowdCompositionResult {
  tierPercentages: Record<string, number>
  tierUniqueCounts: Record<string, number>
  totalUniqueVisitors: number
}

export interface MusicProfileResult {
  archetypeDimensions: Record<string, number>
  topGenres: Array<{ genre: string; visitorCount: number }>
  hasInsufficientData: boolean
}

export interface TrendDelta {
  current: number
  previous: number
  percentChange: number
  direction: 'up' | 'down' | 'flat'
}

export interface TrendResult {
  metrics: Record<string, TrendDelta>
  hasPriorData: boolean
}

export interface JourneyResult {
  topOverlapVenues: Array<{
    venueName: string
    overlapPercentage: number
    overlapCount: number
  }>
  partnershipSuggestions: string[]
  hasInsufficientData: boolean
}

export interface RecommendationResult {
  recommendations: Array<{
    type: 'peak_hours' | 'music' | 'retention' | 'benchmark' | 'general'
    text: string
  }>
}

export interface FullReport {
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

export interface TeaserReport {
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

export interface ReportListItem {
  reportId: string
  periodType: 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  generatedAt: string
  totalCheckIns: number
}

export interface ReportListResponse {
  reports: ReportListItem[]
  cursor?: string
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function isTeaser(report: ReportResponse): report is TeaserReport {
  return 'upgradeMessage' in report
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
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

