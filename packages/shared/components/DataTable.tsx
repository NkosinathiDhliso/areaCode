import type { ReactNode } from 'react'

export type SortDirection = 'asc' | 'desc' | null

export interface DataTableColumn<T> {
  /** Unique key for the column */
  key: string
  /** Column header label */
  header: string
  /** Whether the column is sortable */
  sortable?: boolean
  /** Render function for cell content */
  render: (row: T) => ReactNode
}

export interface DataTablePagination {
  /** Current page (1-indexed) */
  page: number
  /** Total number of pages */
  totalPages: number
  /** Callback when page changes */
  onPageChange: (page: number) => void
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: DataTableColumn<T>[]
  /** Row data */
  data: T[]
  /** Unique key extractor for each row */
  rowKey: (row: T) => string
  /** Currently sorted column key */
  sortKey?: string
  /** Current sort direction */
  sortDirection?: SortDirection
  /** Callback when sort changes */
  onSort?: (key: string, direction: SortDirection) => void
  /** Pagination config */
  pagination?: DataTablePagination
  /** Content to show when data is empty */
  emptyState?: ReactNode
  /** Whether data is loading */
  loading?: boolean
  /** Layout-only className override */
  className?: string
}

/**
 * Shared DataTable component with sortable columns, pagination, and empty state.
 *
 * - Accessible with proper table semantics and aria attributes
 * - Uses token colors and consistent styling
 * - Supports loading skeleton rows
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  sortKey,
  sortDirection,
  onSort,
  pagination,
  emptyState,
  loading = false,
  className = '',
}: DataTableProps<T>) {
  const handleSort = (key: string) => {
    if (!onSort) return
    let newDirection: SortDirection = 'asc'
    if (sortKey === key) {
      newDirection = sortDirection === 'asc' ? 'desc' : sortDirection === 'desc' ? null : 'asc'
    }
    onSort(key, newDirection)
  }

  if (!loading && data.length === 0 && emptyState) {
    return (
      <div className={`rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)] p-[var(--space-6)] text-center ${className}`}>
        {emptyState}
      </div>
    )
  }

  return (
    <div className={`rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)] overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="px-[var(--space-4)] py-[var(--space-3)] text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider"
                  aria-sort={
                    sortKey === col.key
                      ? sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none'
                      : undefined
                  }
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
                      aria-label={`Sort by ${col.header}`}
                    >
                      {col.header}
                      <span aria-hidden="true" className="text-[0.6rem]">
                        {sortKey === col.key
                          ? sortDirection === 'asc' ? '▲' : sortDirection === 'desc' ? '▼' : '⇅'
                          : '⇅'}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="border-b border-[var(--border)] last:border-0">
                    {columns.map((col) => (
                      <td key={col.key} className="px-[var(--space-4)] py-[var(--space-3)]">
                        <div className="h-4 w-3/4 bg-[var(--bg-raised)] rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : data.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-raised)] transition-colors"
                  >
                    {columns.map((col) => (
                      <td key={col.key} className="px-[var(--space-4)] py-[var(--space-3)] text-[var(--text-primary)]">
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => pagination.onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            aria-label="Previous page"
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-[var(--text-muted)]">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => pagination.onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            aria-label="Next page"
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
