import type { HTMLAttributes, ReactNode } from 'react'

export type AlertVariant = 'info' | 'success' | 'warning' | 'error'

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /** Alert variant */
  variant: AlertVariant
  /** Alert title */
  title?: string
  /** Alert message content */
  children: ReactNode
  /** Whether the alert can be dismissed */
  dismissible?: boolean
  /** Callback when dismissed */
  onDismiss?: () => void
  /** Layout-only className override */
  className?: string
}

const variantStyles: Record<AlertVariant, string> = {
  info: 'bg-[var(--info-soft)] border-[var(--info)] text-[var(--text-primary)]',
  success: 'bg-[var(--success-soft)] border-[var(--success)] text-[var(--text-primary)]',
  warning: 'bg-[var(--warning-soft)] border-[var(--warning)] text-[var(--text-primary)]',
  error: 'bg-[var(--danger-soft)] border-[var(--danger)] text-[var(--text-primary)]',
}

const variantIcons: Record<AlertVariant, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
}

/**
 * Shared Alert component for info, success, warning, and error messages.
 *
 * - Uses token colors for each variant
 * - Optional title and dismissible state
 * - Accessible with role="alert"
 */
export function Alert({
  variant,
  title,
  children,
  dismissible = false,
  onDismiss,
  className = '',
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-start gap-3
        px-[var(--space-4)] py-[var(--space-3)]
        rounded-xl border-l-4
        ${variantStyles[variant]}
        ${className}
      `.trim()}
      {...props}
    >
      <span className="shrink-0 text-base" aria-hidden="true">
        {variantIcons[variant]}
      </span>
      <div className="flex-1 min-w-0">
        {title && (
          <p className="font-medium text-sm mb-1">{title}</p>
        )}
        <div className="text-sm text-[var(--text-secondary)]">{children}</div>
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss alert"
          className="shrink-0 p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  )
}
