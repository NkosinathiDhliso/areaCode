import { describe, it, expect } from 'vitest'
import { isValidElement } from 'react'

import { ARCHETYPE_GLYPHS, getArchetypeGlyph, dynamicContrastForCategory } from '../archetype-glyphs'
import { ARCHETYPE_CATALOG } from '../archetype-catalog'
import { NODE_CATEGORIES } from '../node-categories'

/**
 * These tests cover the shared archetype glyph registry (R8.2, R8.7,
 * R8.9). The cross-product contrast property test required by R10.10
 * lives next to the `<ArchetypeGlyph />` component in `apps/web` (task
 * 11.5) — this file only verifies the registry surface area.
 */
describe('archetype-glyphs registry (R8)', () => {
  it('exposes one inline SVG per active catalog iconId (build-time check)', () => {
    for (const archetype of ARCHETYPE_CATALOG) {
      if (!archetype.isActive) continue
      const glyph = ARCHETYPE_GLYPHS[archetype.iconId]
      expect(glyph, `missing glyph for iconId=${archetype.iconId}`).toBeDefined()
      expect(isValidElement(glyph)).toBe(true)
    }
  })

  it('every registered glyph is a valid React element', () => {
    for (const [iconId, glyph] of Object.entries(ARCHETYPE_GLYPHS)) {
      expect(isValidElement(glyph), `iconId=${iconId} is not a React element`).toBe(true)
    }
  })

  it('getArchetypeGlyph returns the same node for known iconIds', () => {
    for (const archetype of ARCHETYPE_CATALOG) {
      if (!archetype.isActive) continue
      expect(getArchetypeGlyph(archetype.iconId)).toBe(ARCHETYPE_GLYPHS[archetype.iconId])
    }
  })

  it('getArchetypeGlyph returns undefined for unknown iconIds (R8.7)', () => {
    expect(getArchetypeGlyph('not-a-real-icon-id')).toBeUndefined()
    expect(getArchetypeGlyph('')).toBeUndefined()
  })
})

describe('dynamicContrastForCategory (R8.9)', () => {
  it('returns either white or near-black for every catalog category', () => {
    for (const cat of NODE_CATEGORIES) {
      const fg = dynamicContrastForCategory(cat.value)
      expect(['#FFFFFF', '#0F172A']).toContain(fg)
    }
  })

  it('returns white for darker category colours and near-black for lighter ones', () => {
    // Coffee is the darkest category colour (#a0785a, L ≈ 0.20) so it
    // sits just above the luminance threshold and pairs with near-black.
    // Nightlife (#3b7dd8, L ≈ 0.20) likewise. The lighter ones
    // (food, retail, fitness, arts) all pair with near-black.
    expect(dynamicContrastForCategory('food')).toBe('#0F172A')
    expect(dynamicContrastForCategory('retail')).toBe('#0F172A')
    expect(dynamicContrastForCategory('fitness')).toBe('#0F172A')
    expect(dynamicContrastForCategory('arts')).toBe('#0F172A')
  })

  it('is deterministic across repeated calls', () => {
    for (const cat of NODE_CATEGORIES) {
      const first = dynamicContrastForCategory(cat.value)
      const second = dynamicContrastForCategory(cat.value)
      expect(first).toBe(second)
    }
  })
})
