import { describe, it, expect } from 'vitest'

import { ARCHETYPE_ICONS, getArchetypeIcon, dynamicContrastForCategory } from '../archetype-icons'
import { ARCHETYPE_CATALOG } from '../archetype-catalog'
import { NODE_CATEGORIES } from '../node-categories'

/**
 * Tests for the shared archetype icon registry (the Phosphor-name data that
 * replaced the hand-drawn SVG glyphs). The registry is pure data, so these
 * assertions cover completeness, the lookup contract, and the contrast helper.
 */
describe('archetype-icons registry', () => {
  it('maps every active catalog iconId to a Phosphor icon spec', () => {
    for (const archetype of ARCHETYPE_CATALOG) {
      if (!archetype.isActive) continue
      const spec = ARCHETYPE_ICONS[archetype.iconId]
      expect(spec, `missing icon for iconId=${archetype.iconId}`).toBeDefined()
      expect(typeof spec!.name).toBe('string')
      expect(spec!.name.length).toBeGreaterThan(0)
      expect(spec!.weight).toBeDefined()
    }
  })

  it('uses valid Phosphor weights', () => {
    const validWeights = new Set(['thin', 'light', 'regular', 'bold', 'fill', 'duotone'])
    for (const spec of Object.values(ARCHETYPE_ICONS)) {
      expect(validWeights.has(spec.weight)).toBe(true)
    }
  })

  it('getArchetypeIcon returns the same spec for known iconIds', () => {
    for (const archetype of ARCHETYPE_CATALOG) {
      if (!archetype.isActive) continue
      expect(getArchetypeIcon(archetype.iconId)).toBe(ARCHETYPE_ICONS[archetype.iconId])
    }
  })

  it('getArchetypeIcon returns undefined for unknown iconIds', () => {
    expect(getArchetypeIcon('not-a-real-icon-id')).toBeUndefined()
    expect(getArchetypeIcon('')).toBeUndefined()
  })
})

describe('dynamicContrastForCategory', () => {
  it('returns either white or near-black for every catalog category', () => {
    for (const cat of NODE_CATEGORIES) {
      expect(['#FFFFFF', '#0F172A']).toContain(dynamicContrastForCategory(cat.value))
    }
  })

  it('pairs near-black with the lighter category colours', () => {
    expect(dynamicContrastForCategory('food')).toBe('#0F172A')
    expect(dynamicContrastForCategory('retail')).toBe('#0F172A')
    expect(dynamicContrastForCategory('fitness')).toBe('#0F172A')
    expect(dynamicContrastForCategory('arts')).toBe('#0F172A')
  })

  it('is deterministic across repeated calls', () => {
    for (const cat of NODE_CATEGORIES) {
      expect(dynamicContrastForCategory(cat.value)).toBe(dynamicContrastForCategory(cat.value))
    }
  })
})
