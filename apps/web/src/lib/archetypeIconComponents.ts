/**
 * Curated Phosphor icon registry for the consumer web app (Bundle_Budget R9.4).
 *
 * The archetype glyph, crowd-vibe chips, and archetype reveal resolve a Phosphor
 * icon component by name at runtime (`registry[spec.name]`). The names always
 * come from the shared `ARCHETYPE_ICONS` data registry, which is a bounded,
 * frozen set. Importing the whole `@phosphor-icons/react` barrel to satisfy that
 * dynamic lookup pulled the entire icon package (~9k components, several MB) into
 * the initial chunk and was the single largest source of consumer bundle bloat.
 *
 * This module imports ONLY the named icons that `ARCHETYPE_ICONS` can reference,
 * so the bundler tree-shakes the rest. It is the one source of truth for which
 * Phosphor components ship to the web consumer. If a new archetype icon is added
 * to `ARCHETYPE_ICONS`, add the matching named import here (the build-time
 * assertion below fails the build until you do).
 *
 * Web-only: mobile uses `phosphor-react-native`, which exposes the same names via
 * its own path and is unaffected by this file.
 */

import { ARCHETYPE_ICONS } from '@area-code/shared/constants'
import type { Icon } from '@phosphor-icons/react'
import {
  Compass,
  Crown,
  Equalizer,
  Flame,
  HandsPraying,
  Lightning,
  MicrophoneStage,
  MoonStars,
  MusicNotes,
  Sparkle,
  SneakerMove,
  Spiral,
  Tree,
  VinylRecord,
  Waveform,
} from '@phosphor-icons/react'

/**
 * name → component, covering every icon `ARCHETYPE_ICONS` can name. Keys match
 * the Phosphor export names stored in the shared data registry.
 */
const ARCHETYPE_ICON_COMPONENTS: Readonly<Record<string, Icon>> = Object.freeze({
  Compass,
  Crown,
  Equalizer,
  Flame,
  HandsPraying,
  Lightning,
  MicrophoneStage,
  MoonStars,
  MusicNotes,
  Sparkle,
  SneakerMove,
  Spiral,
  Tree,
  VinylRecord,
  Waveform,
})

/**
 * Resolve a Phosphor icon component by its export name, or `null` when the name
 * is not one the curated registry ships. Callers apply their own visual
 * fallback (a generic dot / no render) when this returns `null`.
 */
export function resolveArchetypeIconComponent(name: string): Icon | null {
  return ARCHETYPE_ICON_COMPONENTS[name] ?? null
}

// ─── Build-time completeness assertion ───────────────────────────────────────

/**
 * Every icon name the shared data registry can produce must be shipped here, or
 * the glyph silently falls back to a dot in production. Fail the build instead.
 */
const missingComponents = Object.values(ARCHETYPE_ICONS)
  .map((spec) => spec.name)
  .filter((name) => !(name in ARCHETYPE_ICON_COMPONENTS))

if (missingComponents.length > 0) {
  throw new Error(
    `[archetypeIconComponents] Missing curated Phosphor component(s): ${[...new Set(missingComponents)].join(', ')}. ` +
      'Add the matching named import so the icon is not tree-shaken out.',
  )
}
