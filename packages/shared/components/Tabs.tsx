import type { HTMLAttributes } from 'react'

export interface TabItem {
  /** Unique key for the tab */
  key: string
  /** Tab label */
  label: string
  /** Optional badge count */
  count?: number
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'onChange'> {
  /** Tab items to display */
  items: TabItem[]
  /** Currently active tab key */
  activeKey: string
  /** Callback when active tab changes */
  onChange: (key: string) => void
  /** Layout-only className override */
  className?: string
}

/**
 * Shared Tabs component with horizontal pill style and badge counts.
 *
 * - Pill-style active indicator
 * - Optional badge counts per tab
 * - Accessible with role="tablist" and aria attributes
 */
export function Tabs({
  items,
  activeKey,
  onChange,
  className = '',
  ...props
}: TabsProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={`flex gap-1 p-1 rounded-xl bg-[var(--bg-raised)] ${className}`}
      {...props}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${item.key}`}
            id={`tab-${item.key}`}
            onClick={() => onChange(item.key)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
              transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
              ${isActive
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }
            `.trim()}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span
                className={`
                  inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5
                  rounded-full text-[0.65rem] font-semibold
                  ${isActive
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                  }
                `.trim()}
                aria-label={`${item.count} items`}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
