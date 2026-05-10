import type { HTMLAttributes } from 'react'

export type TrendDirection = 'up' | 'down' | 'neutral'

export interface MetricCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /** The metric value to display */
  value: string
  /** Label describing the metric */
  label: string
  /** Trend percentage or delta text */
  trend?: string
  /** Trend direction for color coding */
  trendDirection?: TrendDirection
  /** Show loading skeleton instead of content */
  loading?: boolean
  /** Layout-only className override */
  className?: string
}

const trendColors: Record<TrendDirection, string> = {
  up: 'text-[var(--success)]',
  down: 'text-[var(--danger)]',
  neutral: 'text-[var(--text-muted)]',
}

const trendArrows: Record<TrendDirection, string> = {
  up: '↑',
  down: '↓',
  neutral: '→',
}

/**
 * Shared MetricCard component for displaying KPI values.
 *
 * - Shows value, label, and optional trend indicator
 * - Loading skeleton state for async data
 * - Uses token shadows and consistent card styling
 */
export function MetricCard({
  value,
  label,
  trend,
  trendDirection = 'neutral',
  loading = false,
  className = '',
  ...props
}: MetricCardProps) {
  if (loading) {
    return (
      <div
        className={`
          rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)]
          shadow-[var(--shadow-sm)] px-[var(--space-4)] py-[var(--space-4)]
          ${className}
        `.trim()}
        role="presentation"
        aria-busy="true"
        aria-label={`Loading ${label}`}
        {...props}
      >
        <div className="animate-pulse flex flex-col gap-2">
          <div className="h-3 w-20 bg-[var(--bg-raised)] rounded" />
          <div className="h-7 w-28 bg-[var(--bg-raised)] rounded" />
          <div className="h-3 w-16 bg-[var(--bg-raised)] rounded" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`
        rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)]
        shadow-[var(--shadow-sm)] px-[var(--space-4)] py-[var(--space-4)]
        ${className}
      `.trim()}
      {...props}
    >
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p className="text-2xl font-bold text-[var(--text-primary)]">{value}</p>
      {trend && (
        <p className={`text-xs mt-1 ${trendColors[trendDirection]}`}>
          <span aria-hidden="true">{trendArrows[trendDirection]}</span>{' '}
          <span>{trend}</span>
        </p>
      )}
    </div>
  )
}
