import type { Tier } from '../types'
import { Box } from './primitives'

interface AvatarProps {
  url: string | null
  displayName: string
  tier?: Tier
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_MAP = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-base' }

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export function Avatar({ url, displayName, tier, size = 'md' }: AvatarProps) {
  const sizeClass = SIZE_MAP[size]

  return (
    <Box className={`relative inline-flex items-center justify-center rounded-full ${sizeClass}`}>
      {url ? (
        <img
          src={url}
          alt={displayName}
          className={`rounded-full object-cover ${sizeClass}`}
        />
      ) : (
        <Box
          className={`flex items-center justify-center rounded-full bg-[var(--bg-raised)] text-[var(--text-secondary)] font-medium ${sizeClass}`}
        >
          {getInitials(displayName)}
        </Box>
      )}
      {tier && (
        <Box className="absolute -bottom-0.5 -right-0.5">
          <TierDot tier={tier} />
        </Box>
      )}
    </Box>
  )
}

function TierDot({ tier }: { tier: Tier }) {
  const colorMap: Record<Tier, string> = {
    local: 'bg-[var(--tier-local)]',
    regular: 'bg-[var(--tier-regular)]',
    fixture: 'bg-[var(--tier-fixture)]',
    institution: 'bg-[var(--tier-institution)]',
    legend: '',
  }

  if (tier === 'legend') {
    return (
      <Box
        className="w-3 h-3 rounded-full animate-shimmer"
        style={{ background: 'var(--tier-legend)', backgroundSize: '200% 100%' }}
      />
    )
  }

  return <Box className={`w-3 h-3 rounded-full ${colorMap[tier]}`} />
}
