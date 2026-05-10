import type { InputHTMLAttributes } from 'react'

export type InputVariant = 'text' | 'password' | 'search' | 'code'

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> {
  /** Visual variant */
  variant?: InputVariant
  /** Label text displayed above the input */
  label?: string
  /** Error message displayed below the input */
  error?: string
  /** Helper text displayed below the input */
  helperText?: string
  /** Layout-only className override (positioning, margins, width) */
  className?: string
}

const variantToType: Record<InputVariant, string> = {
  text: 'text',
  password: 'password',
  search: 'search',
  code: 'text',
}

/**
 * Shared Input component with text, password, search, and code variants.
 *
 * - Includes label, error, and helper text slots
 * - Uses token colors and consistent sizing
 * - Accessible with aria-* attributes
 */
export function Input({
  variant = 'text',
  label,
  error,
  helperText,
  className = '',
  id,
  disabled,
  ...props
}: InputProps) {
  const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, '-') || 'field'}`
  const errorId = error ? `${inputId}-error` : undefined
  const helperId = helperText && !error ? `${inputId}-helper` : undefined

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-[var(--text-primary)]"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={variantToType[variant]}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={errorId || helperId}
        className={`
          w-full px-3 py-2 rounded-xl
          bg-[var(--bg-raised)] text-[var(--text-primary)]
          border transition-colors duration-150
          placeholder:text-[var(--text-muted)]
          focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1
          disabled:opacity-50 disabled:pointer-events-none
          ${variant === 'code' ? 'font-mono tracking-wider' : ''}
          ${error
            ? 'border-[var(--danger)] focus:ring-[var(--danger)]'
            : 'border-[var(--border)] hover:border-[var(--border-strong)]'
          }
        `.trim()}
        {...props}
      />
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
