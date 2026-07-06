import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { Tier, User } from '@area-code/shared/types'
import { getTierLabel } from '@area-code/shared/constants/tier-levels'

interface ConsentRow {
  consentVersion?: string
  analyticsOptIn?: boolean
  consentedAt?: string
  [key: string]: unknown
}

interface UserDetail extends User {
  consentRecords: ConsentRow[]
  pushTokens: unknown[]
  notificationPrefs: unknown
}

interface CheckInHistoryItem {
  id: string
  nodeId: string
  checkedInAt: string
  type: string
  node: { name: string; slug: string } | null
}

function formatDate(value?: string): string {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export function ConsumerDetailPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [checkIns, setCheckIns] = useState<CheckInHistoryItem[]>([])
  const [consent, setConsent] = useState<ConsentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [d, ci, c] = await Promise.all([
          api.get<UserDetail>(`/v1/admin/users/${userId}`),
          api.get<CheckInHistoryItem[]>(`/v1/admin/users/${userId}/check-ins`),
          api.get<ConsentRow[]>(`/v1/admin/consent/${userId}`),
        ])
        if (cancelled) return
        setDetail(d)
        setCheckIns(ci)
        setConsent(c)
      } catch {
        if (!cancelled) setError('Failed to load user details. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [userId])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
      <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex flex-row items-center justify-between mb-4">
          <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
            {t('admin.consumers.details', 'User Details')}
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] text-sm">
            Close
          </button>
        </div>

        {loading ? (
          <p className="text-[var(--text-muted)] text-sm">Loading...</p>
        ) : error ? (
          <p className="text-[var(--danger)] text-sm">{error}</p>
        ) : detail ? (
          <div className="flex flex-col gap-5 overflow-y-auto">
            <Profile detail={detail} />
            <CheckInHistory items={checkIns} />
            <ConsentHistory rows={consent} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Profile({ detail }: { detail: UserDetail }) {
  return (
    <section className="flex flex-col gap-1">
      <span className="text-[var(--text-primary)] font-medium">{detail.username}</span>
      <span className="text-[var(--text-muted)] text-xs">{detail.email ?? 'No email'}</span>
      <div className="text-[var(--text-secondary)] text-xs mt-1">
        Tier: <TierLabel tier={detail.tier} /> · Check-ins: {detail.totalCheckIns} · City: {detail.cityId ?? '-'}
      </div>
      <div className="text-[var(--text-secondary)] text-xs">Joined: {formatDate(detail.createdAt)}</div>
    </section>
  )
}

function TierLabel({ tier }: { tier: Tier }) {
  return <span>{getTierLabel(tier)}</span>
}

function CheckInHistory({ items }: { items: CheckInHistoryItem[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[var(--text-primary)] text-sm font-semibold">Check-in history</h4>
      {items.length === 0 ? (
        <p className="text-[var(--text-muted)] text-xs">No check-ins yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((ci) => (
            <div
              key={ci.id}
              className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2"
            >
              <span className="text-[var(--text-primary)] text-xs truncate mr-3">
                {ci.node?.name ?? ci.nodeId ?? 'Unknown venue'}
              </span>
              <span className="text-[var(--text-muted)] text-xs flex-shrink-0">{formatDate(ci.checkedInAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ConsentHistory({ rows }: { rows: ConsentRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[var(--text-primary)] text-sm font-semibold">Consent history</h4>
      {rows.length === 0 ? (
        <p className="text-[var(--text-muted)] text-xs">No consent records.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2"
            >
              <span className="text-[var(--text-primary)] text-xs">
                v{row.consentVersion ?? '-'} · Analytics: {row.analyticsOptIn ? 'opted in' : 'opted out'}
              </span>
              <span className="text-[var(--text-muted)] text-xs flex-shrink-0">{formatDate(row.consentedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
