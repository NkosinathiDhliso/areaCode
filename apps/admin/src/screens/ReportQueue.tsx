import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { Report } from '@area-code/shared/types'
import { formatRelativeTime } from '@area-code/shared/lib/formatters'

interface ReportWithNode extends Report {
  nodeName: string
  sameTypeCount: number
}

export function ReportQueue() {
  const { t } = useTranslation()
  const [reports, setReports] = useState<ReportWithNode[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchReports() {
    try {
      const res = await api.get<{ items: ReportWithNode[] }>('/v1/admin/reports?status=pending')
      setReports(res.items)
    } catch {
      // Fail silently
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [])

  async function handleAction(reportId: string, action: 'reviewed' | 'dismissed' | 'actioned') {
    try {
      await api.post(`/v1/admin/reports/${reportId}/${action}`)
      fetchReports()
    } catch {
      // Fail silently
    }
  }

  if (loading) {
    return <div className="p-5 text-[var(--text-muted)]">Loading...</div>
  }

  return (
    <div className="p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl mb-4 font-[Syne]">
        {t('admin.reports.title')}
      </h2>

      {reports.length === 0 ? (
        <p className="text-[var(--text-muted)]">No pending reports</p>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4"
            >
              <div className="flex flex-row items-center justify-between mb-2">
                <span className="text-[var(--text-primary)] font-medium">{report.nodeName}</span>
                {report.sameTypeCount >= 3 && (
                  <span className="text-[var(--danger)] text-xs">
                    {report.sameTypeCount} similar reports
                  </span>
                )}
              </div>
              <div className="text-[var(--text-secondary)] text-sm mb-1 capitalize">
                {report.type.replace('_', ' ')}
              </div>
              {report.detail && (
                <p className="text-[var(--text-muted)] text-xs mb-3">{report.detail}</p>
              )}
              <div className="flex flex-row items-center justify-between">
                <span className="text-[var(--text-muted)] text-xs">
                  {formatRelativeTime(report.createdAt)}
                </span>
                <div className="flex flex-row gap-2">
                  <button
                    onClick={() => handleAction(report.id, 'reviewed')}
                    className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs"
                  >
                    {t('admin.reports.review')}
                  </button>
                  <button
                    onClick={() => handleAction(report.id, 'dismissed')}
                    className="border border-[var(--border-strong)] text-[var(--text-muted)] rounded-xl px-3 py-1.5 text-xs"
                  >
                    {t('admin.reports.dismiss')}
                  </button>
                  <button
                    onClick={() => handleAction(report.id, 'actioned')}
                    className="border border-[var(--danger)] text-[var(--danger)] rounded-xl px-3 py-1.5 text-xs"
                  >
                    {t('admin.reports.action')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
