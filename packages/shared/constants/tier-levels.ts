import type { Tier } from '../types'

export interface TierLevel {
  tier: Tier
  label: string
  minCheckIns: number
  maxCheckIns: number | null
  colour: string
}

export const TIER_LEVELS: readonly TierLevel[] = [
  { tier: 'local', label: 'Local', minCheckIns: 0, maxCheckIns: 9, colour: 'var(--tier-local)' },
  { tier: 'regular', label: 'Insider', minCheckIns: 10, maxCheckIns: 49, colour: 'var(--tier-regular)' },
  { tier: 'fixture', label: 'Patron', minCheckIns: 50, maxCheckIns: 149, colour: 'var(--tier-fixture)' },
  { tier: 'institution', label: 'Icon', minCheckIns: 150, maxCheckIns: 499, colour: 'var(--tier-institution)' },
  { tier: 'legend', label: 'Legend', minCheckIns: 500, maxCheckIns: null, colour: 'var(--tier-legend)' },
] as const

export function getTier(totalCheckIns: number): Tier {
  if (totalCheckIns >= 500) return 'legend'
  if (totalCheckIns >= 150) return 'institution'
  if (totalCheckIns >= 50) return 'fixture'
  if (totalCheckIns >= 10) return 'regular'
  return 'local'
}

// The one bridge from a tier id to human-facing copy. Every surface that shows
// a rank to a person goes through here; raw ids never reach the UI.
export function getTierLabel(tier: Tier): string {
  const level = TIER_LEVELS.find((l) => l.tier === tier)
  if (!level) throw new Error(`Unknown tier: ${tier}`)
  return level.label
}
