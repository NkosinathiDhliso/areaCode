import type { HTMLAttributes } from 'react'

export interface SheetHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /** Sheet title */
  title: string
  /** Optional subtitle */
  subtitle?: string
  /** Whether to show the close button */
  showClose?: boolean
  /** Callback when close is clicked */
  onClose?: () => void
  /** Whether to show the drag handle */
  dragHandle?: boolean
  /** Layout-only className override */
  className?: string
}

/**
 * Shared SheetHeader component for bottom sheets and panels.
 *
 * - Includes title, subtitle, close button, and drag handle
 * - Drag handle: 40px wide, 4px tall, centered
 * - Accessible with aria-label on close button
 */
export function SheetHeader({
  title,
  subtitle,
  showClose = true,
  onClose,
  dragHandle = true,
  className = '',
  ...props
}: SheetHeaderProps) {
  return (
    <div
      className={`flex flex-col items-center px-[var(--space-4)] pt-[var(--space-3)] pb-[var(--space-4)] ${className}`}
      {...props}
    >
      {dragHandle && (
        <div
          className="w-10 h-1 rounded-full bg-[var(--border-strong)] mb-[var(--space-3)]"
          aria-hidden="true"
        />
      )}
      <div className="flex items-start justify-between w-full">
        <div className="flex-1 min-w-0">
          <h2
            className="text-lg font-semibold text-[var(--text-primary)] truncate"
            id="sheet-title"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-[var(--text-muted)] mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 ml-2 p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
