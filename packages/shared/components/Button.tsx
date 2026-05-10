import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /** Visual variant */
  variant?: ButtonVariant
  /** Size preset */
  size?: ButtonSize
  /** Shows spinner and disables interaction */
  loading?: boolean
  /** Button content */
  children: ReactNode
  /** Layout-only className override (positioning, margins, width) */
  className?: string
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2 text-base rounded-xl gap-2',
  lg: 'px-6 py-3 text-lg rounded-xl gap-2.5',
}

const spinnerSize: Record<ButtonSize, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
}

/**
 * Shared Button component with primary, secondary, ghost, and danger variants.
 *
 * - Primary uses gradient shift on hover/press (--cta-gradient → --cta-gradient-hover)
 * - All variants have active:scale-95 press feedback with 100ms transition
 * - Loading state shows a spinner and disables the button
 * - Accepts className for layout overrides only (positioning, margins, width)
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={loading}
      className={`
        inline-flex items-center justify-center font-medium
        transition-transform duration-100 ease-out
        active:scale-95
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
        disabled:pointer-events-none disabled:opacity-50
        ${sizeClasses[size]}
        ${getVariantClasses(variant)}
        ${className}
      `.trim()}
      {...props}
    >
      {loading && (
        <Spinner
          size={spinnerSize[size]}
          className="shrink-0"
        />
      )}
      <span className={loading ? 'opacity-70' : ''}>{children}</span>
    </button>
  )
}

function getVariantClasses(variant: ButtonVariant): string {
  switch (variant) {
    case 'primary':
      return [
        'text-[var(--on-accent)]',
        'bg-[image:var(--cta-gradient)]',
        'hover:bg-[image:var(--cta-gradient-hover)]',
        'active:bg-[image:var(--cta-gradient-hover)]',
        'shadow-sm',
      ].join(' ')
    case 'secondary':
      return [
        'text-[var(--text-primary)]',
        'bg-[var(--bg-raised)]',
        'border border-[var(--border)]',
        'hover:border-[var(--border-strong)]',
        'hover:bg-[var(--bg-surface)]',
      ].join(' ')
    case 'ghost':
      return [
        'text-[var(--text-secondary)]',
        'bg-transparent',
        'hover:bg-[var(--bg-surface)]',
        'hover:text-[var(--text-primary)]',
      ].join(' ')
    case 'danger':
      return [
        'text-[var(--on-accent)]',
        'bg-[var(--danger)]',
        'hover:brightness-110',
        'active:brightness-90',
        'shadow-sm',
      ].join(' ')
  }
}
