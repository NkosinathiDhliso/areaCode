import type { VenueMomentum } from '@area-code/shared/types'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Honest presence momentum label: "Filling up" (rising) or "Winding down"
 * (falling). Renders nothing for `steady` or when momentum is unknown, so a
 * venue only ever shows a trend the backend genuinely measured from real
 * check-ins and departures (honest-presence rule 5 / discovery-DNA momentum
 * magnet). "Filling up right now" is one of the strongest "go now" triggers, so
 * it leads with the direction, not a raw number.
 *
 * Colour comes from CSS tokens only. Compact by default for cards; the venue
 * detail passes a larger size.
 */
export interface MomentumBadgeProps {
  momentum: VenueMomentum | undefined
  /** Icon+text size. Defaults to compact card size. */
  size?: 'sm' | 'md'
}

export function MomentumBadge({ momentum, size = 'sm' }: MomentumBadgeProps) {
  const { t } = useTranslation()

  if (momentum !== 'filling_up' && momentum !== 'winding_down') return null

  const isRising = momentum === 'filling_up'
  const Icon = isRising ? TrendingUp : TrendingDown
  const label = isRising ? t('momentum.fillingUp', 'Filling up') : t('momentum.windingDown', 'Winding down')
  const colour = isRising ? 'var(--success)' : 'var(--text-muted)'
  const iconPx = size === 'md' ? 16 : 13
  const textClass = size === 'md' ? 'text-sm' : 'text-xs'

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${textClass}`} style={{ color: colour }}>
      <Icon size={iconPx} aria-hidden="true" />
      {label}
    </span>
  )
}
