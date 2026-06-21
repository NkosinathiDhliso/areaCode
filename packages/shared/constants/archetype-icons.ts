/**
 * Archetype icon registry (replaces the old hand-drawn geometric glyphs).
 *
 * This module is **pure data**: it maps each catalog `iconId` to a Phosphor
 * icon component name plus a render weight. It deliberately contains no JSX so
 * it can be imported by both the web app (`@phosphor-icons/react`) and the
 * React Native app (`phosphor-react-native`) - the two packages expose the
 * exact same component names, so a single name string drives both platforms.
 *
 * Why representational icons: the archetypes are music personalities, so the
 * icon should *say* what your taste sounds like (a mic for the Street Poet, a
 * crown for the Township Royal, an equaliser for the Vibe Architect) rather
 * than an abstract triangle. Each icon below was chosen for the clearest read
 * of that persona, and verified to exist in both Phosphor packages.
 *
 * Keys are catalog `iconId` strings, NOT archetype `id`s (the `iconId` is the
 * stable field across the R9 display-name rename).
 */

import type { NodeCategory } from '../types'

import { ARCHETYPE_CATALOG } from './archetype-catalog'

/** Phosphor weights shared by both `@phosphor-icons/react` and `phosphor-react-native`. */
export type ArchetypeIconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'

export interface ArchetypeIconSpec {
  /**
   * Phosphor icon component name. Identical export name in
   * `@phosphor-icons/react` and `phosphor-react-native`.
   */
  name: string
  /**
   * Render weight. `fill` gives a solid silhouette that survives the map
   * marker's category-colour + contrast-outline treatment and stays legible
   * down to ~16px; the larger surfaces (detail sheet, reveal) use the same
   * weight for visual consistency.
   */
  weight: ArchetypeIconWeight
}

/**
 * iconId → Phosphor icon. See the module header for the design rationale.
 * Every active archetype in `ARCHETYPE_CATALOG` must have an entry here; the
 * build-time assertion at the bottom of this file enforces that.
 */
export const ARCHETYPE_ICONS: Readonly<Record<string, ArchetypeIconSpec>> = Object.freeze({
  // Blaze - lives for the packed-crowd energy.
  'festival-spirit': { name: 'Flame', weight: 'fill' },
  // Lumen - soulful creative light.
  'conscious-creative': { name: 'Sparkle', weight: 'fill' },
  // Kasi - township royalty, pride.
  'township-royal': { name: 'Crown', weight: 'fill' },
  // Hymn - spiritual conviction with an edge.
  'sacred-rebel': { name: 'HandsPraying', weight: 'fill' },
  // Spark - pure high-octane energy.
  firecracker: { name: 'Lightning', weight: 'fill' },
  // Drum - high-energy beats rooted in tradition.
  'heritage-groover': { name: 'MusicNotes', weight: 'fill' },
  // Noir - refined late-night thinker.
  'midnight-philosopher': { name: 'MoonStars', weight: 'fill' },
  // Verse - spoken word, storytelling, the mic.
  'street-poet': { name: 'MicrophoneStage', weight: 'fill' },
  // Drift - wanders between depth and sophistication.
  'soul-wanderer': { name: 'Spiral', weight: 'fill' },
  // Cipher - architects the room's sound.
  'vibe-architect': { name: 'Equalizer', weight: 'fill' },
  // Velvet - smooth, effortless, laid-back.
  'smooth-operator': { name: 'Waveform', weight: 'fill' },
  // Bounce - chases the beat, never stops moving.
  'groove-seeker': { name: 'SneakerMove', weight: 'fill' },
  // Root - guardian of cultural heritage.
  'culture-curator': { name: 'Tree', weight: 'fill' },
  // Prism - versatile, plays everything.
  eclectic: { name: 'VinylRecord', weight: 'fill' },
  // Compass - personality waiting to be discovered.
  uncharted: { name: 'Compass', weight: 'fill' },
})

/** Fallback icon spec used when an iconId is unknown (mirrors the eclectic fallback). */
export const FALLBACK_ARCHETYPE_ICON: ArchetypeIconSpec = ARCHETYPE_ICONS.eclectic ?? {
  name: 'VinylRecord',
  weight: 'fill',
}

/**
 * Resolve an `iconId` to its Phosphor icon spec.
 *
 * Returns `undefined` for unregistered ids so callers can fall back to a
 * generic icon and emit a one-shot dev warning, matching the old
 * `getArchetypeGlyph` contract.
 */
export function getArchetypeIcon(iconId: string): ArchetypeIconSpec | undefined {
  return ARCHETYPE_ICONS[iconId]
}

// ─── Contrast helper (unchanged behaviour, moved here from archetype-glyphs) ──

/**
 * Canonical hex values for each `NodeCategory`'s node-core colour. Mirrors the
 * dark-theme tokens; used by the contrast calculation below.
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
 * WCAG luminance boundary (L ≈ 0.179) where contrast against white equals
 * contrast against black. Guarantees ≥3:1 contrast on every category colour.
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
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
}

/**
 * Pick a foreground/outline colour for the archetype icon that keeps contrast
 * against the node-core colour ≥3:1 (R8.9). White for darker category
 * colours, near-black for lighter ones.
 */
export function dynamicContrastForCategory(category: NodeCategory): typeof WHITE | typeof NEAR_BLACK {
  const hex = NODE_CATEGORY_HEX[category]
  if (!hex) return WHITE
  return relativeLuminance(hex) > LUMINANCE_THRESHOLD ? NEAR_BLACK : WHITE
}

// ─── Build-time completeness assertion ───────────────────────────────────────

/**
 * Every active catalog Archetype must have a registered icon. Runs at import
 * time so a missing entry fails the build rather than silently falling back in
 * production.
 */
const missingIcons = ARCHETYPE_CATALOG.filter(
  (archetype) => archetype.isActive && !(archetype.iconId in ARCHETYPE_ICONS),
).map((archetype) => archetype.iconId)

if (missingIcons.length > 0) {
  throw new Error(
    `[archetype-icons] Missing icon registry entries for iconId(s): ${missingIcons.join(', ')}. ` +
      'Every active ARCHETYPE_CATALOG entry must have a corresponding Phosphor icon in ARCHETYPE_ICONS.',
  )
}
