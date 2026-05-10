import type { SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  /** Options to display */
  options: SelectOption[]
  /** Label text displayed above the select */
  label?: string
  /** Error message displayed below the select */
  error?: string
  /** Helper text displayed below the select */
  helperText?: string
  /** Placeholder option text */
  placeholder?: string
  /** Layout-only className override (positioning, margins, width) */
  className?: string
}

/**
 * Shared Select component with label, error, and helper text.
 *
 * - Uses token colors and consistent sizing
 * - Accessible with aria-* attributes
 * - Matches Input component styling
 */
export function Select({
  options,
  label,
  error,
  helperText,
  placeholder,
  className = '',
  id,
  disabled,
  ...props
}: SelectProps) {
  const selectId = id || `select-${label?.toLowerCase().replace(/\s+/g, '-') || 'field'}`
  const errorId = error ? `${selectId}-error` : undefined
  const helperId = helperText && !error ? `${selectId}-helper` : undefined

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-[var(--text-primary)]"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={errorId || helperId}
        className={`
          w-full px-3 py-2 rounded-xl appearance-none
          bg-[var(--bg-raised)] text-[var(--text-primary)]
          border transition-colors duration-150
          focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1
          disabled:opacity-50 disabled:pointer-events-none
          ${error
            ? 'border-[var(--danger)] focus:ring-[var(--danger)]'
            : 'border-[var(--border)] hover:border-[var(--border-strong)]'
          }
        `.trim()}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={helperId} className="text-xs text-[var(--text-muted)]">
          {helperText}
        </p>
      )}
    </div>
  )
}
