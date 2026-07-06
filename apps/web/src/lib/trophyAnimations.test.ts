import type { Tier } from '@area-code/shared/types'
import { describe, expect, it } from 'vitest'

import {
  getTrophyDescriptor,
  TROPHY_MAX_ANIMATED_NODES,
  TROPHY_MAX_DURATION_MS,
  type TrophyDescriptor,
} from './trophyAnimations'

// The five ranks in ascending order (design D7). Order matters: the duration
// monotonicity check relies on it.
const TIERS_ASCENDING: readonly Tier[] = ['local', 'regular', 'fixture', 'institution', 'legend']

// Per-tier full-motion durations from design D7.
const EXPECTED_DURATIONS: Readonly<Record<Tier, number>> = {
  local: 2000,
  regular: 2400,
  fixture: 2800,
  institution: 3200,
  legend: 3600,
}

// The numeric effect-count fields subject to the compositor budget.
const EFFECT_COUNT_FIELDS: readonly (keyof TrophyDescriptor)[] = [
  'rippleRings',
  'sparkBurst',
  'orbitingSparks',
  'rays',
  'fountainParticles',
  'starfieldParticles',
]

describe('trophyAnimations', () => {
  it('returns a descriptor for every tier, keyed by the requested tier', () => {
    for (const tier of TIERS_ASCENDING) {
      const descriptor = getTrophyDescriptor(tier)
      expect(descriptor).toBeDefined()
      expect(descriptor.tier).toBe(tier)
    }
  })

  it('matches the design D7 per-tier durations', () => {
    for (const tier of TIERS_ASCENDING) {
      expect(getTrophyDescriptor(tier).durationMs).toBe(EXPECTED_DURATIONS[tier])
    }
  })

  it('keeps every duration within [2000, 3600]', () => {
    for (const tier of TIERS_ASCENDING) {
      const { durationMs } = getTrophyDescriptor(tier)
      expect(durationMs).toBeGreaterThanOrEqual(2000)
      expect(durationMs).toBeLessThanOrEqual(3600)
    }
  })

  it('keeps every duration strictly under the hard cap', () => {
    for (const tier of TIERS_ASCENDING) {
      expect(getTrophyDescriptor(tier).durationMs).toBeLessThan(TROPHY_MAX_DURATION_MS)
    }
  })

  // Requirement 5.3: spectacle escalates with rank.
  it('escalates durations monotonically with rank', () => {
    for (let i = 1; i < TIERS_ASCENDING.length; i += 1) {
      const prev = getTrophyDescriptor(TIERS_ASCENDING[i - 1]).durationMs
      const curr = getTrophyDescriptor(TIERS_ASCENDING[i]).durationMs
      expect(curr).toBeGreaterThan(prev)
    }
  })

  it('honours the compositor budget: no effect count exceeds the node cap', () => {
    for (const tier of TIERS_ASCENDING) {
      const descriptor = getTrophyDescriptor(tier)
      for (const field of EFFECT_COUNT_FIELDS) {
        expect(descriptor[field] as number).toBeLessThanOrEqual(TROPHY_MAX_ANIMATED_NODES)
      }
    }
  })

  it('runs the legend starfield at exactly the node cap', () => {
    expect(getTrophyDescriptor('legend').starfieldParticles).toBe(TROPHY_MAX_ANIMATED_NODES)
  })
})
