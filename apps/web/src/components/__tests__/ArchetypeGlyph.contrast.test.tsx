/**
 * Property 10: Archetype_Glyph silhouette ≥ 3:1 against its outline.
 *
 * Validates: Requirements 8.9, 10.10.
 *
 * Layout note (R8 redesign).
 *   The glyph is no longer a small icon overlaid on a coloured node
 *   core. It is the marker. Each glyph is drawn twice stacked: a
 *   stroked outline pass underneath in `dynamicContrastForCategory`'s
 *   colour, and a fill pass on top in the venue's category colour
 *   (`getCategoryColour`). The outline gives the silhouette edge
 *   separation against any Mapbox basemap (light, dark, satellite),
 *   and the silhouette carries the category channel.
 *
 *   The relevant contrast pairing is therefore **silhouette vs
 *   outline** - those two colours determine whether the silhouette
 *   reads on top of its own outline. Both colours render at 1.0
 *   opacity inside the SVG; the wrapper's CSS `opacity` (R8.3 / R8.4)
 *   scales them together against the basemap, so the silhouette /
 *   outline pair stays in lockstep at every Pulse_State and the
 *   gamma-space compositing footgun from the previous design no longer
 *   applies. R8.9's 3:1 floor therefore holds across all five
 *   Pulse_States in the new layout, and the cross-product reverts to
 *   the original 15 × 5 × 6 = 450 cells.
 *
 * Notes on size (R8.9):
 *   The smallest supported glyph size is 8px. Size does not enter the
 *   WCAG 2.0 contrast formula, but we pin it here so any future size-
 *   dependent relaxation starts from the worst case.
 *
 * Notes on the contrast formula:
 *   WCAG 2.0 relative luminance from sRGB:
 *     channel_lin = c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4
 *     L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin
 *   contrast(a, b) = (Lmax + 0.05) / (Lmin + 0.05).
 */
import { describe, expect, it } from 'vitest'

import { ARCHETYPE_CATALOG, dynamicContrastForCategory } from '@area-code/shared/constants'
import type { NodeCategory, NodeState } from '@area-code/shared/types'

// ─── Cross-product domain ───────────────────────────────────────────────────

/** Every Pulse_State (R8.3 / R8.4). */
const PULSE_STATES: readonly NodeState[] = ['dormant', 'quiet', 'active', 'buzzing', 'popping'] as const

/** Every value of `NodeCategory` mirrored from `NODE_CATEGORIES`. */
const CATEGORIES: readonly NodeCategory[] = ['food', 'coffee', 'nightlife', 'retail', 'fitness', 'arts'] as const

/**
 * Mirrors `NODE_CATEGORY_HEX` from
 * `packages/shared/constants/archetype-glyphs.tsx` and
 * `apps/web/src/lib/mapHelpers.ts`'s `getCategoryColour`. The runtime
 * source of truth is `packages/shared/tokens.css` (`--node-*` vars).
 * If those tokens drift, both this fixture and the registry's internal
 * map need to be updated together.
 */
const NODE_CATEGORY_HEX: Readonly<Record<NodeCategory, string>> = {
  food: '#ff6b6b',
  coffee: '#a0785a',
  nightlife: '#3b7dd8',
  retail: '#38bdf8',
  fitness: '#22d3a0',
  arts: '#ff9f43',
}

/** R8.9 contrast floor for silhouette vs outline. */
const MIN_CONTRAST_RATIO = 3.0

/** R8.9 minimum supported glyph size. Pinned for documentation only. */
const MIN_GLYPH_SIZE_PX = 8

// ─── WCAG 2.0 contrast helpers ──────────────────────────────────────────────

interface RGB {
  readonly r: number
  readonly g: number
  readonly b: number
}

function hexToRgb(hex: string): RGB {
  const v = hex.startsWith('#') ? hex.slice(1) : hex
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  }
}

/** sRGB channel (0-255) → linear-light component (0-1) per WCAG 2.0. */
function channelToLinear(c: number): number {
  const norm = c / 255
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4)
}

/** WCAG 2.0 relative luminance for an sRGB triple. */
function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

/** WCAG 2.0 contrast ratio between two sRGB triples. Always ≥ 1.0. */
function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// ─── Property 10 ────────────────────────────────────────────────────────────

describe('Property 10: Archetype_Glyph silhouette ≥ 3:1 against its outline', () => {
  /**
   * Sanity check the cross-product cardinality so the test fails loud
   * if a future catalog change drops or adds an entry without updating
   * R10.10's documented count.
   *
   * Domain: 15 archetypes × 5 pulse states × 6 categories = 450.
   */
  it('enumerates the documented cross-product (15 × 5 × 6 = 450)', () => {
    expect(ARCHETYPE_CATALOG.length).toBe(15)
    expect(PULSE_STATES.length).toBe(5)
    expect(CATEGORIES.length).toBe(6)
    expect(ARCHETYPE_CATALOG.length * PULSE_STATES.length * CATEGORIES.length).toBe(450)
    expect(MIN_GLYPH_SIZE_PX).toBe(8)
  })

  /**
   * Validates: Requirements 8.9, 10.10.
   *
   * For every (archetype × pulse_state × category) triple, the glyph's
   * silhouette colour (the category hex) maintains a contrast ratio of
   * ≥ 3:1 against its outline colour (the WCAG-safe contrast colour
   * from `dynamicContrastForCategory`). Pulse_State does not appear in
   * the formula because both colours render at 1.0 opacity inside the
   * SVG and the wrapper's CSS opacity scales them together - pulse
   * state only affects the marker's overall presence against the
   * basemap, not the silhouette/outline pairing.
   */
  it('every (archetype × pulse_state × category) silhouette is ≥ 3:1 against its outline', () => {
    interface Failure {
      archetypeId: string
      pulseState: NodeState
      category: NodeCategory
      silhouette: string
      outline: string
      contrast: number
    }

    const failures: Failure[] = []
    for (const archetype of ARCHETYPE_CATALOG) {
      for (const pulseState of PULSE_STATES) {
        for (const category of CATEGORIES) {
          const silhouetteHex = NODE_CATEGORY_HEX[category]
          const outlineHex = dynamicContrastForCategory(category)
          const ratio = contrastRatio(hexToRgb(silhouetteHex), hexToRgb(outlineHex))

          if (ratio < MIN_CONTRAST_RATIO) {
            failures.push({
              archetypeId: archetype.id,
              pulseState,
              category,
              silhouette: silhouetteHex,
              outline: outlineHex,
              contrast: Math.round(ratio * 100) / 100,
            })
          }
        }
      }
    }

    expect(
      failures,
      `Found ${failures.length} (archetype × pulse_state × category) ` +
        `combinations with silhouette/outline contrast < ${MIN_CONTRAST_RATIO}:1.\n` +
        `First 5 (of ${failures.length}):\n` +
        JSON.stringify(failures.slice(0, 5), null, 2),
    ).toEqual([])
  })
})
