/**
 * Billing Panel — payment history table with date, description, amount in ZAR,
 * status badge, current plan name, and next billing date.
 *
 * Requirements: 9.1, 9.3, 9.4
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { DataTable, type DataTableColumn } from '@area-code/shared/components/DataTable'
import { Badge, type BadgeStatus } from '@area-code/shared/components/Badge'

interface BillingRecord {
  paymentId: string
  date: string
  description: string
  amount: number
  status: 'succeeded' | 'failed' | 'refunded' | 'pending'
  type: string
  planTier: string
}

interface BillingResponse {
  items: BillingRecord[]
  nextCursor: string | null
  hasMore: boolean
}

interface BusinessProfile {
  tier?: string
  trialEndsAt?: string | null
  nextBillingDate?: string | null
  businessName?: string
}

function formatZARCents(cents: number): string {
  return (cents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })
}

function getStatusBadge(status: string): { label: string; badgeStatus: BadgeStatus } {
  switch (status) {
    case 'succeeded':
      return { label: 'Paid', badgeStatus: 'success' }
    case 'failed':
      return { label: 'Failed', badgeStatus: 'error' }
    case 'pending':
      return { label: 'Pending', badgeStatus: 'warning' }
    case 'refunded':
      return { label: 'Refunded', badgeStatus: 'neutral' }
    default:
      return { label: status, badgeStatus: 'neutral' }
  }
}

function getPlanDisplayName(tier: string | undefined): string {
  switch (tier) {
    case 'growth': return 'Growth'
    case 'pro': return 'Pro'
    case 'flex_daily':
    case 'payg': return 'Flex Daily'
    case 'starter':
    default: return 'Starter (Free)'
  }
}

export function BillingPanel() {
  const { t } = useTranslation()
  const [records, setRecords] = useState<BillingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [hasMore, setHasMore] = useState(false)
  const [profile, setProfile] = useState<BusinessProfile | null>(null)

  async function fetchBilling(cursor: string | null) {
    setLoading(true)
    setError(false)
    try {
      const path = cursor ? `/v1/business/me/billing?cursor=${cursor}` : '/v1/business/me/billing'
      const res = await api.get<BillingResponse>(path)
      setRecords(res.items)
      setHasMore(res.hasMore)
      if (res.nextCursor && !cursors.includes(res.nextCursor)) {
        setCursors((prev) => [...prev, res.nextCursor])
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  async function fetchProfile() {
    try {
      const res = await api.get<BusinessProfile>('/v1/business/me')
      setProfile(res)
    } catch {
      // Non-critical
    }
  }

  useEffect(() => {
    void fetchProfile()
    void fetchBilling(null)
  }, [])

  function handlePageChange(newPage: number) {
    const cursorIdx = newPage - 1
    const cursor = cursors[cursorIdx] ?? null
    setPage(newPage)
    void fetchBilling(cursor)
  }

  const columns: DataTableColumn<BillingRecord>[] = [
    {
      key: 'date',
      header: t('biz.billing.date', 'Date'),
      sortable: true,
      render: (row) => new Date(row.date).toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'short', year: 'numeric',
      }),
    },
    {
      key: 'description',
      header: t('biz.billing.description', 'Description'),
      render: (row) => row.description,
    },
    {
      key: 'amount',
      header: t('biz.billing.amount', 'Amount'),
      sortable: true,
      render: (row) => formatZARCents(row.amount),
    },
    {
      key: 'status',
      header: t('biz.billing.status', 'Status'),
      render: (row) => {
        const { label, badgeStatus } = getStatusBadge(row.status)
        return <Badge variant="status" label={label} status={badgeStatus} />
      },
    },
  ]

  // Compute total pages (approximate — cursor-based)
  const totalPages = hasMore ? page + 1 : page

  if (error) {
    return (
      <div className="p-5 flex flex-col items-center gap-3 py-12">
        <p className="text-[var(--text-muted)] text-sm">{t('biz.billing.error', 'Failed to load billing history')}</p>
        <button onClick={() => void fetchBilling(null)} className="text-[var(--accent)] text-sm">
          {t('common.retry', 'Retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('biz.billing.title', 'Billing')}
      </h2>

      {/* Current plan and next billing date */}
      {profile && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">{t('biz.billing.currentPlan', 'Current Plan')}</span>
            <span className="text-[var(--text-primary)] text-sm font-semibold">
              {getPlanDisplayName(profile.tier)}
            </span>
          </div>
          {profile.nextBillingDate && (
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] text-xs">{t('biz.billing.nextBilling', 'Next Billing')}</span>
              <span className="text-[var(--text-secondary)] text-sm">
                {new Date(profile.nextBillingDate).toLocaleDateString('en-ZA', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Payment history table */}
      <DataTable
        columns={columns}
        data={records}
        rowKey={(row) => row.paymentId}
        loading={loading}
        pagination={{
          page,
          totalPages,
          onPageChange: handlePageChange,
        }}
        emptyState={
          <p className="text-[var(--text-muted)] text-sm py-4">
            {t('biz.billing.empty', 'No payment history yet')}
          </p>
        }
      />
    </div>
  )
}
