import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'

interface AuditLogEntry {
  id: string
  adminId: string
  adminRole: string
  action: string
  entityType: string
  entityId: string
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
  createdAt: string
}

export function AuditTrailViewer() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filters
  const [filterAdminId, setFilterAdminId] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterStartDate, setFilterStartDate] = useState('')
  const [filterEndDate, setFilterEndDate] = useState('')

  async function fetchLogs(cursor?: string) {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      if (filterAdminId) params.set('adminId', filterAdminId)
      if (filterAction) params.set('action', filterAction)
      if (filterStartDate) params.set('startDate', filterStartDate)
      if (filterEndDate) params.set('endDate', filterEndDate)

      const res = await api.get<{ items: AuditLogEntry[]; nextCursor: string | null }>(
        `/v1/admin/audit-logs?${params.toString()}`,
      )
      if (cursor) {
        setLogs((prev) => [...prev, ...res.items])
      } else {
        setLogs(res.items)
      }
      setNextCursor(res.nextCursor)
    } catch {
      // Fail silently
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  function handleApplyFilters() {
    setNextCursor(null)
    fetchLogs()
  }

  function handleClearFilters() {
    setFilterAdminId('')
    setFilterAction('')
    setFilterStartDate('')
    setFilterEndDate('')
    setNextCursor(null)
    // Fetch with cleared filters
    setTimeout(() => fetchLogs(), 0)
  }

  return (
    <div className="p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl mb-4 font-[Syne]">
        {t('admin.auditTrail.title', 'Audit Trail')}
      </h2>

      {/* Filter controls */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <input
            type="text"
            value={filterAdminId}
            onChange={(e) => setFilterAdminId(e.target.value)}
            placeholder="Admin ID"
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-xs placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="text"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="Action type"
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-xs placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-xs focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-xs focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div className="flex flex-row gap-2">
          <button
            onClick={handleApplyFilters}
            className="bg-[var(--accent)] text-white rounded-xl px-4 py-2 text-xs font-medium"
          >
            Apply Filters
          </button>
          <button
            onClick={handleClearFilters}
            className="text-[var(--text-muted)] text-xs px-4 py-2"
          >
            Clear
          </button>
        </div>
      </div>

      {loading && logs.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-12">
          Loading audit logs...
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-12">
          No audit logs found
        </div>
      )}

      <div className="flex flex-col gap-2">
        {logs.map((log) => (
          <div
            key={log.id}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4"
          >
            <div
              className="flex flex-row items-center justify-between cursor-pointer"
              onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-row items-center gap-2">
                  <span className="text-[var(--accent)] text-xs font-medium px-2 py-0.5 rounded-lg bg-[var(--bg-raised)]">
                    {log.action}
                  </span>
                  <span className="text-[var(--text-secondary)] text-xs">
                    {log.entityType}: {log.entityId.slice(0, 8)}...
                  </span>
                </div>
                <span className="text-[var(--text-muted)] text-xs">
                  by {log.adminId.slice(0, 8)}... ({log.adminRole})
                </span>
              </div>
              <span className="text-[var(--text-muted)] text-xs">
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>

            {expandedId === log.id && (
              <div className="mt-3 pt-3 border-t border-[var(--border)] grid grid-cols-2 gap-3">
                {log.beforeState && (
                  <div>
                    <span className="text-[var(--text-muted)] text-xs font-medium block mb-1">Before</span>
                    <pre className="bg-[var(--bg-raised)] rounded-xl p-3 text-[var(--text-secondary)] text-xs overflow-x-auto max-h-32">
                      {JSON.stringify(log.beforeState, null, 2)}
                    </pre>
                  </div>
                )}
                {log.afterState && (
                  <div>
                    <span className="text-[var(--text-muted)] text-xs font-medium block mb-1">After</span>
                    <pre className="bg-[var(--bg-raised)] rounded-xl p-3 text-[var(--text-secondary)] text-xs overflow-x-auto max-h-32">
                      {JSON.stringify(log.afterState, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {nextCursor && (
        <button
          onClick={() => fetchLogs(nextCursor)}
          disabled={loading}
          className="w-full text-[var(--accent)] text-sm font-medium py-3 mt-2"
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}
