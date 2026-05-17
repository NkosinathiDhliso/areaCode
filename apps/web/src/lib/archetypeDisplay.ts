/**
 * Render-side wrapper around `getArchetypeDisplayName` that satisfies R9.10:
 *
 *   "If a surface is asked to render an `archetypeId` that has no entry in
 *    the Archetype_Rename_Map, then the surface SHALL render the raw `id`
 *    AND SHALL emit a non-blocking observability warning."
 *
 * The shared `getArchetypeDisplayName(id)` already returns the raw id for
 * unknown archetypes, but it is intentionally side-effect-free (its property
 * tests assert it depends on nothing but the input id, see R9.13). Surfaces
 * therefore need a thin helper that adds the warning behaviour without
 * polluting the shared module's purity contract.
 *
 * Warnings are de-duplicated per id per session so the console isn't flooded
 * if a stale archetypeId is rendered repeatedly across re-renders.
 */
import { ARCHETYPE_NAMES, getArchetypeDisplayName } from '@area-code/shared/constants'
import { recordEvent } from '@area-code/shared/lib/rum'

const warnedUnknownIds = new Set<string>()

/**
 * Resolve an archetype id to its short display name and emit a non-blocking
 * observability warning the first time an unknown id is rendered.
 *
 * Behaves identically to `getArchetypeDisplayName` from the consumer's
 * perspective: returns the resolved name, or the raw id when unknown.
 */
export function resolveArchetypeDisplayName(id: string): string {
  if (!(id in ARCHETYPE_NAMES) && !warnedUnknownIds.has(id)) {
    warnedUnknownIds.add(id)
    // eslint-disable-next-line no-console
    console.warn(`[archetype-names] Unknown archetypeId="${id}"; rendering raw id (R9.10).`)
    // Best-effort RUM event so the warning surfaces beyond the user's
    // browser console. `recordEvent` is a no-op when RUM isn't initialised.
    recordEvent('archetype_display_name_unknown_id', { archetypeId: id })
  }
  return getArchetypeDisplayName(id)
}
