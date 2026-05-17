/**
 * Archetype glyph registry (R8.2, R8.7, R8.9).
 *
 * Each catalog `iconId` maps to an inline SVG `ReactNode`. The Node
 * renderer reaches in via `getArchetypeGlyph(iconId)` and paints the
 * glyph as a child of the existing pulse `<g>`, inheriting the breathe /
 * pulse animation per R8.5.
 *
 * Glyphs use `fill="currentColor"` so the caller can drive foreground
 * colour with `dynamicContrastForCategory(category)` — the design rule
 * for keeping the glyph above the 3:1 contrast floor against the node
 * core colour at every Pulse_State (R8.9).
 *
 * Build-time check: importing this module asserts that every active
 * catalog Archetype has a registered glyph. If a future catalog entry
 * adds a new `iconId` without a matching registry entry, the import
 * throws immediately — the build fails before the missing glyph ever
 * reaches a node.
 */

import type { ReactNode } from 'react'

import type { NodeCategory } from '../types'
import { ARCHETYPE_CATALOG } from './archetype-catalog'

/** SVG attributes shared by every glyph in the registry. */
const GLYPH_VIEWBOX = '0 0 24 24'

/**
 * Inline SVGs are drawn small (24×24 viewBox) and use `fill="currentColor"`
 * so the parent component can drive foreground colour via the
 * `dynamicContrastForCategory` helper. Each glyph is a simple geometric
 * shape distinct enough to convey the archetype concept at the smallest
 * supported render size (8px per R8.9).
 *
 * Keys are catalog `iconId` strings, NOT archetype `id`s. The catalog
 * keeps the `iconId` field stable across renames (R9.3) so this map is
 * agnostic to the R9 display-name rename.
 */
export const ARCHETYPE_GLYPHS: Readonly<Record<string, ReactNode>> = Object.freeze({
  // Blaze — flame outline, two licks of fire.
  'festival-spirit': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M12 2c1.5 3 4.5 5 4.5 9a4.5 4.5 0 1 1-9 0c0-2 1-3 1-5 1.5 1 2 2 2 4 1-2 .5-5 1.5-8z" />
    </svg>
  ),
  // Lumen — sunburst of rays.
  'conscious-creative': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  // Kasi — crown silhouette, three points.
  'township-royal': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4v10H3z" />
    </svg>
  ),
  // Hymn — cross with a soft rising line.
  'sacred-rebel': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M11 3h2v6h6v2h-6v10h-2V11H5V9h6z" />
    </svg>
  ),
  // Spark — four-pointed compass star.
  firecracker: (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z" />
    </svg>
  ),
  // Drum — concentric circles, like a drumhead.
  'heritage-groover': (
    <svg viewBox={GLYPH_VIEWBOX} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  ),
  // Noir — crescent moon.
  'midnight-philosopher': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M20 14a9 9 0 1 1-10-10 7 7 0 0 0 10 10z" />
    </svg>
  ),
  // Verse — speech / quote bubble.
  'street-poet': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M4 4h16v12H7l-3 4z" />
    </svg>
  ),
  // Drift — two stacked waves.
  'soul-wanderer': (
    <svg
      viewBox={GLYPH_VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 9c2.5-3 5.5-3 8 0s5.5 3 8 0 4-3 4-3" />
      <path d="M2 17c2.5-3 5.5-3 8 0s5.5 3 8 0 4-3 4-3" />
    </svg>
  ),
  // Cipher — hexagon (architect's lattice).
  'vibe-architect': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
    </svg>
  ),
  // Velvet — diamond (smooth, faceted).
  'smooth-operator': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M12 2l10 10-10 10L2 12z" />
    </svg>
  ),
  // Bounce — chevron / zigzag pulse.
  'groove-seeker': (
    <svg
      viewBox={GLYPH_VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 18l5-12 5 12 5-12 5 12" />
    </svg>
  ),
  // Root — leaf with stem.
  'culture-curator': (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M5 21c0-9 6-15 15-15 0 9-6 15-15 15z" />
      <path d="M5 21c4-4 8-8 12-12" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  // Prism — triangle (refracts everything).
  eclectic: (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d="M12 3l10 17H2z" />
    </svg>
  ),
  // Compass — arrow / needle pointing up.
  uncharted: (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 5l3 9-3-2-3 2z" />
    </svg>
  ),
})

/**
 * Lookup helper used by `<ArchetypeGlyph />` (R8.2, R8.7).
 *
 * Returns `undefined` for unregistered ids so the caller can fall back
 * to the generic dot glyph and emit a one-shot dev warning per R8.7 /
 * R8.8. Lookup is by `iconId`, not archetype `id`.
 */
export function getArchetypeGlyph(iconId: string): ReactNode | undefined {
  return ARCHETYPE_GLYPHS[iconId]
}

/**
 * Canonical hex values for each `NodeCategory`'s node-core colour.
 *
 * The CSS variables in `packages/shared/tokens.css` are the runtime
 * source of truth, but the contrast calculation needs concrete hex.
 * These mirror the dark-theme values (the production default); the
 * light-theme palette uses slightly darker variants that yield the same
 * contrast direction, so the choice of foreground holds across themes.
 */
const NODE_CATEGORY_HEX: Readonly<Record<NodeCategory, string>> = Object.freeze({
  food: '#ff6b6b',
  coffee: '#a0785a',
  nightlife: '#3b7dd8',
  retail: '#38bdf8',
  fitness: '#22d3a0',
  arts: '#ff9f43',
})

/** Near-black foreground returned when the node-core colour is light. */
const NEAR_BLACK = '#0F172A'
/** White foreground returned when the node-core colour is dark. */
const WHITE = '#FFFFFF'

/**
 * Relative luminance threshold for swapping foreground colour.
 *
 * WCAG defines the boundary where contrast against white equals
 * contrast against black at L ≈ 0.179. For any colour with L below
 * that, white gives the higher contrast ratio; above, near-black does.
 * Sticking to that boundary guarantees ≥3:1 contrast on every category
 * colour we ship today.
 */
const LUMINANCE_THRESHOLD = 0.179

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  const rl = srgbChannelToLinear(r)
  const gl = srgbChannelToLinear(g)
  const bl = srgbChannelToLinear(b)
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

/**
 * Pick a foreground colour for the archetype glyph that keeps contrast
 * against the node-core colour ≥3:1 (R8.9).
 *
 * Returns `'#FFFFFF'` for darker category colours and the near-black
 * `'#0F172A'` for lighter ones, using the WCAG luminance boundary at
 * `LUMINANCE_THRESHOLD = 0.179` as the cutoff. Unknown categories fall
 * back to white, which is the safe choice on any colour darker than
 * mid-gray.
 */
export function dynamicContrastForCategory(category: NodeCategory): typeof WHITE | typeof NEAR_BLACK {
  const hex = NODE_CATEGORY_HEX[category]
  if (!hex) return WHITE
  return relativeLuminance(hex) > LUMINANCE_THRESHOLD ? NEAR_BLACK : WHITE
}

/**
 * Build-time assertion: every active catalog Archetype has a registered
 * glyph. Runs at import time so a missing registry entry surfaces as an
 * import error rather than a silent fallback in production. The
 * `<ArchetypeGlyph />` component still renders the generic dot fallback
 * at runtime for defence in depth, but the catalog should never reach
 * production with a hole in this map.
 */
const missingGlyphs = ARCHETYPE_CATALOG.filter(
  (archetype) => archetype.isActive && !(archetype.iconId in ARCHETYPE_GLYPHS),
).map((archetype) => archetype.iconId)

if (missingGlyphs.length > 0) {
  throw new Error(
    `[archetype-glyphs] Missing glyph registry entries for iconId(s): ${missingGlyphs.join(', ')}. ` +
      'Every active ARCHETYPE_CATALOG entry must have a corresponding inline SVG in ARCHETYPE_GLYPHS.',
  )
}
