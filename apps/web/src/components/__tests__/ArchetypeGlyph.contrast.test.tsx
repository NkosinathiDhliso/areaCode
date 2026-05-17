/**
 * Property 10: Archetype_Glyph contrast ≥ 3:1 across the cross-product.
 *
 * Validates: Requirements 8.9, 10.10.
 *
 * R10.10 enumerates every (archetype × Pulse_State × category) triple
 * (currently 15 archetypes × 5 pulse states × 6 categories = 450
 * combinations) at the smallest supported glyph size and asserts the
 * rendered glyph foreground produces a contrast ratio ≥ 3:1 against
 * the node-core colour (R8.9).
 *
 * Notes on opacity (R8.3 / R8.4):
 *   - `pulseState` does not change the chosen foreground colour — that
 *     comes from `dynamicContrastForCategory(category)` and is purely a
 *     function of the node-core colour. Pulse_State only changes the
 *     glyph layer's CSS `opacity` (40% for `dormant`, 100% for the four
 *     active states).
 *   - CSS `opacity` on a child element is equivalent to source-over
 *     alpha compositing in gamma space (browsers do not linearise
 *     before blending the `opacity` property). The pixel the user
 *     actually sees is therefore `α·FG + (1-α)·BG`, with BG being the
 *     node-core fill drawn one layer behind.
 *   - This means the effective foreground colour gets closer to the
 *     node-core as opacity drops, which compresses the contrast ratio.
 *     The worst case across Pulse_States is therefore `dormant` at 40%
 *     opacity. R8.9 requires ≥ 3:1 "at every Pulse_State", so the
 *     property has to hold at that worst case too.
 *
 * Notes on size (R8.9):
 *   - The smallest supported glyph size is 8px (R8.9, enforced by the
 *     `MIN_GLYPH_SIZE_PX` constant in `ArchetypeGlyph.tsx`). Size does
 *     not enter the WCAG 2.0 contrast formula, but we pin the smallest
 *     supported size here so any future size-dependent relaxation
 *     (e.g. a "≥ 3:1 only at large-text size" rule) starts from the
 *     worst case.
 *
 * Notes on the contrast formula:
 *   - WCAG 2.0 relative luminance from sRGB:
 *       channel_lin = c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4
 *       L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin
 *     and contrast(a, b) = (Lmax + 0.05) / (Lmin + 0.05).
 *
 * Notes on the node-core hex map:
 *   - `NODE_CATEGORY_HEX` is module-private inside
 *     `packages/shared/constants/archetype-glyphs.tsx`, so we mirror
 *     the canonical values here. The runtime source of truth is
 *     `packages/shared/tokens.css` (`--node-*` vars). If the tokens
 *     drift, both this fixture and the registry's internal map need to
 *     be updated together.
 */
import { describe, expect, it } from 'vitest'

import { ARCHETYPE_CATALOG, dynamicContrastForCategory } from '@area-code/shared/constants'
import type { NodeCategory, NodeState } from '@area-code/shared/types'

// ─── Cross-product domain ───────────────────────────────────────────────────

/** Every value of `NodeState` (R8.3 / R8.4). */
const PULSE_STATES: readonly NodeState[] = ['dormant', 'quiet', 'active', 'buzzing', 'popping'] as const

/** Every value of `NodeCategory` mirrored from `NODE_CATEGORIES`. */
const CATEGORIES: readonly NodeCategory[] = ['food', 'coffee', 'nightlife', 'retail', 'fitness', 'arts'] as const

/**
 * Mirrors `NODE_CATEGORY_HEX` from
 * `packages/shared/constants/archetype-glyphs.tsx`. The runtime source
 * of truth is `packages/shared/tokens.css` — these are the dark-theme
 * `--node-*` values, which is the production default.
 */
const NODE_CATEGORY_HEX: Readonly<Record<NodeCategory, string>> = {
  food: '#ff6b6b',
  coffee: '#a0785a',
  nightlife: '#3b7dd8',
  retail: '#38bdf8',
  fitness: '#22d3a0',
  arts: '#ff9f43',
}

/**
 * Per R8.3 / R8.4: dormant renders at 40% opacity, every other state
 * at 100%. Mirrors `DORMANT_OPACITY` / `ACTIVE_OPACITY` constants in
 * `apps/web/src/components/ArchetypeGlyph.tsx`.
 */
const STATE_OPACITY: Readonly<Record<NodeState, number>> = {
  dormant: 0.4,
  quiet: 1.0,
  active: 1.0,
  buzzing: 1.0,
  popping: 1.0,
}

/** R8.9 contrast floor for glyph foreground vs node-core. */
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

/**
 * Source-over alpha compositing in gamma (sRGB) space. This is what
 * the browser does for CSS `opacity` on a child element — it does NOT
 * linearise before blending the opacity property.
 */
function compositeOver(fg: RGB, bg: RGB, alpha: number): RGB {
  return {
    r: alpha * fg.r + (1 - alpha) * bg.r,
    g: alpha * fg.g + (1 - alpha) * bg.g,
    b: alpha * fg.b + (1 - alpha) * bg.b,
  }
}

// ─── Property 10 ────────────────────────────────────────────────────────────

describe('Property 10: Archetype_Glyph contrast ≥ 3:1 across the cross-product', () => {
  /**
   * Sanity check the cross-product cardinality so the test fails loud
   * if a future catalog change drops or adds an entry without updating
   * R10.10's enumerated count.
   */
  it('enumerates the documented cross-product (15 × 5 × 6 = 450)', () => {
    expect(ARCHETYPE_CATALOG.length).toBe(15)
    expect(PULSE_STATES.length).toBe(5)
    expect(CATEGORIES.length).toBe(6)
    expect(ARCHETYPE_CATALOG.length * PULSE_STATES.length * CATEGORIES.length).toBe(450)
    // Smallest supported glyph size is pinned for documentation; size
    // does not enter the WCAG 2.0 colour-pair contrast formula.
    expect(MIN_GLYPH_SIZE_PX).toBe(8)
  })

  /**
   * Validates: Requirements 8.9, 10.10.
   *
   * For every (archetype × pulse_state × category) triple, the
   * rendered glyph foreground (alpha-composited per the Pulse_State
   * opacity rules) maintains a contrast ratio of ≥ 3:1 against the
   * node-core colour.
   */
  it('every (archetype × pulse_state × category) renders at ≥ 3:1 contrast against the node-core colour', () => {
    interface Failure {
      archetypeId: string
      pulseState: NodeState
      category: NodeCategory
      foreground: string
      compositedForeground: string
      background: string
      contrast: number
    }

    const failures: Failure[] = []
    for (const archetype of ARCHETYPE_CATALOG) {
      for (const pulseState of PULSE_STATES) {
        for (const category of CATEGORIES) {
          const fgHex = dynamicContrastForCategory(category)
          const bgHex = NODE_CATEGORY_HEX[category]
          const fg = hexToRgb(fgHex)
          const bg = hexToRgb(bgHex)
          const alpha = STATE_OPACITY[pulseState]
          const composited = compositeOver(fg, bg, alpha)
          const ratio = contrastRatio(composited, bg)

          if (ratio < MIN_CONTRAST_RATIO) {
            failures.push({
              archetypeId: archetype.id,
              pulseState,
              category,
              foreground: fgHex,
              compositedForeground:
                '#' +
                [composited.r, composited.g, composited.b]
                  .map((c) => Math.round(c).toString(16).padStart(2, '0'))
                  .join(''),
              background: bgHex,
              contrast: Math.round(ratio * 100) / 100,
            })
          }
        }
      }
    }

    expect(
      failures,
      `Found ${failures.length} (archetype × pulse_state × category) ` +
        `combinations with contrast < ${MIN_CONTRAST_RATIO}:1.\n` +
        `First 5 (of ${failures.length}):\n` +
        JSON.stringify(failures.slice(0, 5), null, 2),
    ).toEqual([])
  })
})
