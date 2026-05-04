import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'

interface AbuseFlag {
  id: string
  type: string
  entityId: string
  entityType: string
  evidenceJson: Record<string, unknown> | null
  reviewed: boolean
  createdAt: string
}

export function AbuseFlagDashboard() {
  const { t } = useTranslation()
  const [flags, setFlags] = useState<AbuseFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function fetchFlags() {
    try {
      const res = await api.get<{ items: AbuseFlag[] }>('/v1/admin/abuse-flags')
      setFlags(res.items)
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFlags()
    const interval = setInterval(fetchFlags, 30000)
    return () => clearInterval(interval)
  }, [])

  async function handleReview(flagId: string) {
    setActionLoading(flagId)
    setActionError(null)
    try {
      await api.post(`/v1/admin/abuse-flags/${flagId}/review`)
      void fetchFlags()
    } catch {
      setActionError('Failed to mark as reviewed. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleAction(flagId: string, action: string) {
    setActionLoading(flagId)
    setActionError(null)
    try {
      await api.post(`/v1/admin/abuse-flags/${flagId}/action`, { action })
      void fetchFlags()
    } catch {
      setActionError('Action failed. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  function getTypeBadgeColor(type: string): string {
    switch (type) {
      case 'device_velocity':
        return 'var(--warning)'
      case 'ip_subnet':
        return 'var(--warning)'
      case 'pulse_anomaly':
        return 'var(--accent)'
      case 'reward_drain':
        return 'var(--danger)'
      case 'new_account_velocity':
        return 'var(--danger)'
      default:
        return 'var(--text-muted)'
    }
  }

  if (loading) {
    return <div className="p-5 text-[var(--text-muted)] text-sm text-center py-12">Loading abuse flags...</div>
  }

  return (
    <div className="p-5">
      {loadError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm mb-4">
          Failed to load abuse flags.{' '}
          <button onClick={() => void fetchFlags()} className="underline ml-1">
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm mb-4">
          {actionError}
        </div>
      )}
      <div className="flex flex-row items-center justify-between mb-4">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('admin.abuseFlags.title', 'Abuse Flags')}
        </h2>
        {flags.length > 0 && (
          <span className="bg-[var(--danger)] text-white text-xs font-bold rounded-full px-2.5 py-1">
            {flags.length}
          </span>
        )}
      </div>

      {flags.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-12">No unreviewed abuse flags</div>
      )}

      <div className="flex flex-col gap-3">
        {flags.map((flag) => (
          <div key={flag.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
            <div
              className="flex flex-row items-center justify-between cursor-pointer"
              onClick={() => setExpandedId(expandedId === flag.id ? null : flag.id)}
            >
              <div className="flex flex-row items-center gap-3">
                <span
                  className="text-xs font-medium px-2 py-1 rounded-lg"
                  style={{
                    color: getTypeBadgeColor(flag.type),
                    backgroundColor: `color-mix(in srgb, ${getTypeBadgeColor(flag.type)} 15%, transparent)`,
                  }}
                >
                  {flag.type}
                </span>
                <span className="text-[var(--text-primary)] text-sm">
                  {flag.entityType}: {flag.entityId.slice(0, 8)}...
                </span>
              </div>
              <span className="text-[var(--text-muted)] text-xs">{new Date(flag.createdAt).toLocaleDateString()}</span>
            </div>

            {expandedId === flag.id && (
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                {/* Evidence JSON */}
                {flag.evidenceJson && (
                  <pre className="bg-[var(--bg-raised)] rounded-xl p-3 text-[var(--text-secondary)] text-xs overflow-x-auto mb-3 max-h-40">
                    {JSON.stringify(flag.evidenceJson, null, 2)}
                  </pre>
                )}

                <div className="flex flex-row gap-2">
                  <button
                    onClick={() => void handleReview(flag.id)}
                    disabled={actionLoading === flag.id}
                    className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    Mark Reviewed
                  </button>
                  <button
                    onClick={() => void handleAction(flag.id, 'disable_user')}
                    disabled={actionLoading === flag.id}
                    className="border border-[var(--danger)] text-[var(--danger)] rounded-xl px-3 py-1.5 text-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    Disable User
                  </button>
                  <button
                    onClick={() => void handleAction(flag.id, 'reset_flags')}
                    disabled={actionLoading === flag.id}
                    className="border border-[var(--warning)] text-[var(--warning)] rounded-xl px-3 py-1.5 text-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    Reset Flags
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
