import type { HTMLAttributes } from 'react'

export type BadgeVariant = 'status' | 'tier' | 'pulse-state'

export type BadgeStatus = 'success' | 'warning' | 'error' | 'info' | 'neutral'
export type BadgeTier = 'local' | 'regular' | 'fixture' | 'institution' | 'legend'
export type BadgePulseState = 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  /** Visual variant category */
  variant: BadgeVariant
  /** Label text */
  label: string
  /** Status type (when variant is 'status') */
  status?: BadgeStatus
  /** Tier type (when variant is 'tier') */
  tier?: BadgeTier
  /** Pulse state (when variant is 'pulse-state') */
  pulseState?: BadgePulseState
  /** Layout-only className override */
  className?: string
}

const statusStyles: Record<BadgeStatus, string> = {
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  error: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
  neutral: 'bg-[var(--bg-raised)] text-[var(--text-secondary)]',
}

const tierStyles: Record<BadgeTier, string> = {
  local: 'bg-[var(--bg-raised)] text-[var(--tier-local)]',
  regular: 'bg-[var(--bg-raised)] text-[var(--tier-regular)]',
  fixture: 'bg-[var(--bg-raised)] text-[var(--tier-fixture)]',
  institution: 'bg-[var(--bg-raised)] text-[var(--tier-institution)]',
  legend: 'text-white',
}

const pulseStateStyles: Record<BadgePulseState, string> = {
  dormant: 'bg-[var(--bg-raised)] text-[var(--text-muted)]',
  quiet: 'bg-[var(--bg-raised)] text-[var(--text-secondary)]',
  active: 'bg-[var(--success-soft)] text-[var(--success)]',
  buzzing: 'bg-[var(--info-soft)] text-[var(--info)]',
  popping: 'bg-[var(--danger-soft)] text-[var(--danger)]',
}

/**
 * Shared Badge component with status, tier, and pulse-state variants.
 *
 * - Uses token colors for all variants
 * - Pulse-state variants map to: dormant, quiet, active, buzzing, popping
 * - Legend tier uses animated gradient background
 */
export function Badge({
  variant,
  label,
  status = 'neutral',
  tier = 'local',
  pulseState = 'dormant',
  className = '',
  ...props
}: BadgeProps) {
  const baseClasses = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium'

  let variantClasses = ''
  let style: React.CSSProperties | undefined

  switch (variant) {
    case 'status':
      variantClasses = statusStyles[status]
      break
    case 'tier':
      if (tier === 'legend') {
        variantClasses = tierStyles.legend
        style = { background: 'var(--tier-legend)', backgroundSize: '200% 100%' }
      } else {
        variantClasses = tierStyles[tier]
      }
      break
    case 'pulse-state':
      variantClasses = pulseStateStyles[pulseState]
      break
  }

  return (
    <span
      className={`${baseClasses} ${variantClasses} ${tier === 'legend' && variant === 'tier' ? 'animate-shimmer' : ''} ${className}`.trim()}
      style={style}
      role="status"
      aria-label={`${variant}: ${label}`}
      {...props}
    >
      {label}
    </span>
  )
}
