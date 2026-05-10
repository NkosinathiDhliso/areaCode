import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /** Optional header slot */
  header?: ReactNode
  /** Card body content */
  children: ReactNode
  /** Optional footer slot */
  footer?: ReactNode
  /** Layout-only className override (positioning, margins, width) */
  className?: string
}

/**
 * Shared Card component with header, body, and footer slots.
 *
 * - Uses rounded-2xl with token shadows
 * - Consistent internal padding (--space-4 minimum)
 * - Glass-style background from token system
 */
export function Card({
  header,
  children,
  footer,
  className = '',
  ...props
}: CardProps) {
  return (
    <div
      className={`
        rounded-2xl
        bg-[var(--bg-surface)]
        border border-[var(--border)]
        shadow-[var(--shadow-md)]
        overflow-hidden
        ${className}
      `.trim()}
      {...props}
    >
      {header && (
        <div
          className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]"
          role="heading"
          aria-level={3}
        >
          {header}
        </div>
      )}
      <div className="px-[var(--space-4)] py-[var(--space-4)]">
        {children}
      </div>
      {footer && (
        <div className="px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border)]">
          {footer}
        </div>
      )}
    </div>
  )
}
