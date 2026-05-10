import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ActionRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /** Icon element displayed on the left */
  icon?: ReactNode
  /** Label text */
  label: string
  /** Optional description text below the label */
  description?: string
  /** Whether to show the chevron on the right */
  chevron?: boolean
  /** Optional right-side content (badge, value, etc.) */
  trailing?: ReactNode
  /** Layout-only className override */
  className?: string
}

/**
 * Shared ActionRow component for list actions.
 *
 * - Icon + label + chevron pattern
 * - Optional description and trailing content
 * - Accessible as a button with hover/press states
 */
export function ActionRow({
  icon,
  label,
  description,
  chevron = true,
  trailing,
  className = '',
  disabled,
  ...props
}: ActionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`
        w-full flex items-center gap-3
        px-[var(--space-4)] py-[var(--space-3)]
        text-left rounded-xl
        transition-colors duration-150
        hover:bg-[var(--bg-raised)]
        active:scale-[0.98]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
        disabled:opacity-50 disabled:pointer-events-none
        ${className}
      `.trim()}
      {...props}
    >
      {icon && (
        <span className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[var(--accent)]" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-[var(--text-primary)] truncate">
          {label}
        </span>
        {description && (
          <span className="block text-xs text-[var(--text-muted)] truncate mt-0.5">
            {description}
          </span>
        )}
      </div>
      {trailing && (
        <span className="shrink-0 text-sm text-[var(--text-muted)]">
          {trailing}
        </span>
      )}
      {chevron && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0 text-[var(--text-muted)]"
          aria-hidden="true"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}
