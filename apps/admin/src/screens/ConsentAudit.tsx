import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { ConsentRecord } from '@area-code/shared/types'
import { formatLocalDate } from '@area-code/shared/lib/formatters'

interface ErasureRequest {
  userId: string
  username: string
  requestedAt: string
  deletesAt: string
}

export function ConsentAudit() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'consent' | 'erasure'>('consent')
  const [consents, setConsents] = useState<ConsentRecord[]>([])
  const [erasures, setErasures] = useState<ErasureRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [exportMsg, setExportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoadError(false)
      try {
        if (tab === 'consent') {
          const res = await api.get<{ items: ConsentRecord[] }>('/v1/admin/consent')
          if (!cancelled) setConsents(res.items)
        } else {
          const res = await api.get<{ items: ErasureRequest[] }>('/v1/admin/erasure-queue')
          if (!cancelled) setErasures(res.items)
        }
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setLoading(true)
    fetch()
    return () => {
      cancelled = true
    }
  }, [tab])

  async function handleExport() {
    setExportMsg(null)
    try {
      const data = await api.get<Array<{ id: string; username: string; phone: string }>>(
        '/v1/admin/consent/export-reconsent',
      )
      const items = Array.isArray(data) ? data : []
      // Build CSV from JSON response
      const csvHeader = 'userId,username,phone'
      const csvRows = items.map(
        (item) => `${item.id ?? ''},${(item.username ?? '').replace(/,/g, '')},${(item.phone ?? '').replace(/,/g, '')}`,
      )
      const csvContent = [csvHeader, ...csvRows].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'reconsent-list.csv'
      a.click()
      URL.revokeObjectURL(url)
      setExportMsg({ type: 'success', text: `Exported ${items.length} records.` })
    } catch {
      setExportMsg({ type: 'error', text: 'Export failed. Please try again.' })
    }
  }

  return (
    <div className="p-5">
      <div className="flex flex-row items-center justify-between mb-4">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('admin.consent.title')}</h2>
        <button
          onClick={handleExport}
          className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-4 py-2 text-xs"
        >
          {t('admin.consent.export')}
        </button>
      </div>

      {exportMsg && (
        <div className={`border rounded-xl p-3 text-sm mb-4 ${
          exportMsg.type === 'success'
            ? 'bg-[var(--success)]/10 border-[var(--success)] text-[var(--success)]'
            : 'bg-[var(--danger)]/10 border-[var(--danger)] text-[var(--danger)]'
        }`}>
          {exportMsg.text}
        </div>
      )}
      {loadError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm mb-4">
          Failed to load data. Please try switching tabs or refreshing.
        </div>
      )}

      <div className="flex flex-row gap-2 mb-4">
        <button
          onClick={() => setTab('consent')}
          className={`px-4 py-2 rounded-xl text-sm ${
            tab === 'consent' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
          }`}
        >
          Consent Records
        </button>
        <button
          onClick={() => setTab('erasure')}
          className={`px-4 py-2 rounded-xl text-sm ${
            tab === 'erasure' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
          }`}
        >
          {t('admin.consent.erasureQueue')}
        </button>
      </div>

      {loading ? (
        <p className="text-[var(--text-muted)]">Loading...</p>
      ) : tab === 'consent' ? (
        <div className="flex flex-col gap-2">
          {consents.map((c) => (
            <div
              key={c.id}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-row items-center justify-between"
            >
              <div className="text-[var(--text-primary)] text-sm">User {c.userId.slice(0, 8)}...</div>
              <div className="flex flex-row gap-3 text-xs">
                <span className={c.analyticsOptIn ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}>
                  Analytics: {c.analyticsOptIn ? 'ON' : 'OFF'}
                </span>
                <span className="text-[var(--text-muted)]">
                  v{c.consentVersion} · {formatLocalDate(c.consentedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {erasures.map((e) => (
            <div
              key={e.userId}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-row items-center justify-between"
            >
              <div>
                <span className="text-[var(--text-primary)] text-sm">{e.username}</span>
                <span className="text-[var(--text-muted)] text-xs ml-2">
                  Requested {formatLocalDate(e.requestedAt)}
                </span>
              </div>
              <span className="text-[var(--danger)] text-xs">Deletes {formatLocalDate(e.deletesAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
