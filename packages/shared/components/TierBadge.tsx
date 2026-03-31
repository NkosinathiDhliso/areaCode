import type { Tier } from '../types'
import { Text } from './primitives'

interface TierBadgeProps {
  tier: Tier
}

const TIER_LABELS: Record<Tier, string> = {
  local: 'Local',
  regular: 'Regular',
  fixture: 'Fixture',
  institution: 'Institution',
  legend: 'Legend',
}

const TIER_STYLES: Record<Tier, string> = {
  local: 'bg-[var(--tier-local)] bg-opacity-20 text-[var(--tier-local)]',
  regular: 'bg-[var(--tier-regular)] bg-opacity-20 text-[var(--tier-regular)]',
  fixture: 'bg-[var(--tier-fixture)] bg-opacity-20 text-[var(--tier-fixture)]',
  institution: 'bg-[var(--tier-institution)] bg-opacity-20 text-[var(--tier-institution)]',
  legend: '',
}

export function TierBadge({ tier }: TierBadgeProps) {
  if (tier === 'legend') {
    return (
      <Text
        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white animate-shimmer"
        style={{ background: 'var(--tier-legend)', backgroundSize: '200% 100%' }}
      >
        {TIER_LABELS[tier]}
      </Text>
    )
  }

  return (
    <Text className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TIER_STYLES[tier]}`}>
      {TIER_LABELS[tier]}
    </Text>
  )
}
