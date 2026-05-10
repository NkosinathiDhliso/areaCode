/**
 * Admin Revenue Dashboard — displays MRR, boost revenue, subscription counts,
 * trial conversion rate, Flex Daily revenue, and per-business breakdown.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { MetricCard } from '@area-code/shared/components/MetricCard'
import { DataTable, type DataTableColumn } from '@area-code/shared/components/DataTable'
import { Tabs, type TabItem } from '@area-code/shared/components/Tabs'

type DateRange = 'today' | 'this_week' | 'this_month' | 'custom'

interface RevenueMetrics {
  mrr: number
  boostRevenue: number
  subscriptionCounts: Record<string, number>
  trialConversionRate: number
  flexDailyRevenue: number
  dateRange: { start: string; end: string; filter: string }
}

interface BusinessRevenueRow {
  businessId: string
  businessName: string
  planTier: string
  totalPaid: number
  lastPaymentDate: string
}

interface BreakdownResponse {
  items: BusinessRevenueRow[]
  dateRange: { start: string; end: string; filter: string }
}

function formatZARCents(cents: number): string {
  return (cents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })
}

function getDateRangeTabs(t: ReturnType<typeof useTranslation>['t']): TabItem[] {
  return [
    { key: 'today', label: t('admin.revenue.today', 'Today') },
    { key: 'this_week', label: t('admin.revenue.thisWeek', 'This Week') },
    { key: 'this_month', label: t('admin.revenue.thisMonth', 'This Month') },
  ]
}

export function RevenueDashboard() {
  const { t } = useTranslation()
  const [metrics, setMetrics] = useState<RevenueMetrics | null>(null)
  const [breakdown, setBreakdown] = useState<BusinessRevenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [breakdownLoading, setBreakdownLoading] = useState(true)
  const [range, setRange] = useState<DateRange>('this_month')
  const [error, setError] = useState(false)

  async function fetchMetrics(selectedRange: DateRange) {
    setLoading(true)
    setError(false)
    try {
      const res = await api.get<RevenueMetrics>(`/v1/admin/revenue?range=${selectedRange}`)
      setMetrics(res)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  async function fetchBreakdown(selectedRange: DateRange) {
    setBreakdownLoading(true)
    try {
      const res = await api.get<BreakdownResponse>(`/v1/admin/revenue/breakdown?range=${selectedRange}`)
      setBreakdown(res.items)
    } catch {
      // Silently fail for breakdown
    } finally {
      setBreakdownLoading(false)
    }
  }

  useEffect(() => {
    void fetchMetrics(range)
    void fetchBreakdown(range)
  }, [range])

  function handleRangeChange(key: string) {
    setRange(key as DateRange)
  }

  const breakdownColumns: DataTableColumn<BusinessRevenueRow>[] = [
    { key: 'businessName', header: t('admin.revenue.colBusiness', 'Business'), render: (row) => row.businessName },
    { key: 'planTier', header: t('admin.revenue.colPlan', 'Plan'), render: (row) => row.planTier },
    { key: 'totalPaid', header: t('admin.revenue.colTotalPaid', 'Total Paid'), sortable: true, render: (row) => formatZARCents(row.totalPaid) },
    {
      key: 'lastPaymentDate',
      header: t('admin.revenue.colLastPayment', 'Last Payment'),
      sortable: true,
      render: (row) => new Date(row.lastPaymentDate).toLocaleDateString('en-ZA'),
    },
  ]

  if (error) {
    return (
      <div className="p-5 flex flex-col items-center gap-3 py-12">
        <p className="text-[var(--text-muted)] text-sm">{t('admin.revenue.error', 'Failed to load revenue data')}</p>
        <button onClick={() => void fetchMetrics(range)} className="text-[var(--accent)] text-sm">
          {t('common.retry', 'Retry')}
        </button>
      </div>
    )
  }

  const subCounts = metrics?.subscriptionCounts ?? {}
  const totalSubs = Object.values(subCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="p-5 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('admin.revenue.title', 'Revenue Dashboard')}
        </h2>
        <Tabs items={getDateRangeTabs(t)} activeKey={range} onChange={handleRangeChange} className="w-fit" />
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          label={t('admin.revenue.mrr', 'MRR')}
          value={metrics ? formatZARCents(metrics.mrr) : '—'}
          loading={loading}
        />
        <MetricCard
          label={t('admin.revenue.boostRevenue', 'Boost Revenue')}
          value={metrics ? formatZARCents(metrics.boostRevenue) : '—'}
          loading={loading}
        />
        <MetricCard
          label={t('admin.revenue.activeSubs', 'Active Subscriptions')}
          value={metrics ? String(totalSubs) : '—'}
          trend={metrics ? `S:${subCounts['starter'] ?? 0} G:${subCounts['growth'] ?? 0} P:${subCounts['pro'] ?? 0} F:${subCounts['flex_daily'] ?? 0}` : undefined}
          loading={loading}
        />
        <MetricCard
          label={t('admin.revenue.trialConversion', 'Trial Conversion')}
          value={metrics ? `${metrics.trialConversionRate}%` : '—'}
          loading={loading}
        />
        <MetricCard
          label={t('admin.revenue.flexDaily', 'Flex Daily Revenue')}
          value={metrics ? formatZARCents(metrics.flexDailyRevenue) : '—'}
          loading={loading}
        />
      </div>

      {/* Per-Business Breakdown */}
      <div className="flex flex-col gap-3">
        <h3 className="text-[var(--text-primary)] font-semibold text-base">
          {t('admin.revenue.breakdown', 'Per-Business Breakdown')}
        </h3>
        <DataTable
          columns={breakdownColumns}
          data={breakdown}
          rowKey={(row) => row.businessId}
          loading={breakdownLoading}
          emptyState={
            <p className="text-[var(--text-muted)] text-sm py-4">
              {t('admin.revenue.noData', 'No revenue data for this period')}
            </p>
          }
        />
      </div>
    </div>
  )
}
