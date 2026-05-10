import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'

interface SystemHealthMetrics {
  lambdaErrorRate: number | null
  dlqDepth: number
  lastSuccessfulYocoWebhook: string | null
}

interface WebSocketHealthMetrics {
  activeConnections: number
  connectionsByRoom: Record<string, number>
  uptimeSeconds: number
}

function getStatusColor(metrics: SystemHealthMetrics): string {
  if (metrics.lambdaErrorRate !== null && metrics.lambdaErrorRate > 5) return 'var(--danger)'
  if (metrics.dlqDepth > 0) return 'var(--warning)'
  if (metrics.lambdaErrorRate !== null && metrics.lambdaErrorRate > 1) return 'var(--warning)'
  return 'var(--success)'
}

function getStatusLabel(metrics: SystemHealthMetrics): string {
  if (metrics.lambdaErrorRate !== null && metrics.lambdaErrorRate > 5) return 'Degraded'
  if (metrics.dlqDepth > 0) return 'Warning'
  if (metrics.lambdaErrorRate !== null && metrics.lambdaErrorRate > 1) return 'Elevated'
  return 'Healthy'
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'No data'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function SystemHealth() {
  const { t } = useTranslation()
  const [metrics, setMetrics] = useState<SystemHealthMetrics | null>(null)
  const [wsMetrics, setWsMetrics] = useState<WebSocketHealthMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  async function fetchHealth() {
    try {
      setError(false)
      const [res, wsRes] = await Promise.all([
        api.get<SystemHealthMetrics>('/v1/admin/system-health'),
        api.get<WebSocketHealthMetrics>('/v1/health/websocket').catch(() => null),
      ])
      setMetrics(res)
      if (wsRes) setWsMetrics(wsRes)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading && !metrics) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <div className="animate-pulse flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-[var(--border)]" />
          <div className="h-4 w-32 bg-[var(--border)] rounded" />
        </div>
      </div>
    )
  }

  if (error && !metrics) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)] text-sm">System health unavailable</span>
          <button onClick={() => void fetchHealth()} className="text-[var(--accent)] text-xs">
            {t('common.retry', 'Retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!metrics) return null

  const statusColor = getStatusColor(metrics)
  const statusLabel = getStatusLabel(metrics)

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full inline-block"
            style={{ backgroundColor: statusColor }}
            aria-label={`System status: ${statusLabel}`}
          />
          <span className="text-[var(--text-primary)] text-sm font-semibold">System Health</span>
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: statusColor, backgroundColor: `color-mix(in srgb, ${statusColor} 15%, transparent)` }}>
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-bold font-[Syne]" style={{ color: metrics.lambdaErrorRate !== null && metrics.lambdaErrorRate > 5 ? 'var(--danger)' : 'var(--text-primary)' }}>
            {metrics.lambdaErrorRate !== null ? `${metrics.lambdaErrorRate}%` : '—'}
          </span>
          <span className="text-[var(--text-muted)] text-xs text-center">Lambda Errors</span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-bold font-[Syne]" style={{ color: metrics.dlqDepth > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
            {metrics.dlqDepth}
          </span>
          <span className="text-[var(--text-muted)] text-xs text-center">DLQ Depth</span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-bold font-[Syne]" style={{ color: metrics.lastSuccessfulYocoWebhook ? 'var(--text-primary)' : 'var(--warning)' }}>
            {formatTimestamp(metrics.lastSuccessfulYocoWebhook)}
          </span>
          <span className="text-[var(--text-muted)] text-xs text-center">Last Yoco OK</span>
        </div>
      </div>

      {wsMetrics && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center justify-between">
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-lg font-bold font-[Syne] text-[var(--text-primary)]">
                {wsMetrics.activeConnections}
              </span>
              <span className="text-[var(--text-muted)] text-xs text-center">Active WebSocket Connections</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
