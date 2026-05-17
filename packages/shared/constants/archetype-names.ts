/**
 * Archetype rename module (R9).
 *
 * Maps catalog archetype ids to short display names used everywhere on
 * consumer-facing surfaces. The catalog `name` field on
 * `archetype-catalog.ts` is intentionally kept untouched so admin tools
 * can still render the long-form name (R9.7); the rename is purely a
 * presentation concern with no DynamoDB migration (R9.2, R9.3).
 *
 * R9.13: there is no per-locale override. The function signature only
 * accepts an `id` so a future locale parameter cannot be added without a
 * code review touching this central module.
 */

export interface ArchetypeNameEntry {
  id: string
  displayName: string
  /** Present only for non-English names per R9.12. */
  etymology?: string
}

export const ARCHETYPE_NAMES: Readonly<Record<string, ArchetypeNameEntry>> = Object.freeze({
  'archetype-festival-spirit': {
    id: 'archetype-festival-spirit',
    displayName: 'Blaze',
  },
  'archetype-conscious-creative': {
    id: 'archetype-conscious-creative',
    displayName: 'Lumen',
  },
  'archetype-township-royal': {
    id: 'archetype-township-royal',
    displayName: 'Kasi',
    etymology: 'isiZulu and isiXhosa for township; a word of pride, born in South Africa.',
  },
  'archetype-sacred-rebel': {
    id: 'archetype-sacred-rebel',
    displayName: 'Hymn',
  },
  'archetype-firecracker': {
    id: 'archetype-firecracker',
    displayName: 'Spark',
  },
  'archetype-heritage-groover': {
    id: 'archetype-heritage-groover',
    displayName: 'Drum',
  },
  'archetype-midnight-philosopher': {
    id: 'archetype-midnight-philosopher',
    displayName: 'Noir',
  },
  'archetype-street-poet': {
    id: 'archetype-street-poet',
    displayName: 'Verse',
  },
  'archetype-soul-wanderer': {
    id: 'archetype-soul-wanderer',
    displayName: 'Drift',
  },
  'archetype-vibe-architect': {
    id: 'archetype-vibe-architect',
    displayName: 'Cipher',
  },
  'archetype-smooth-operator': {
    id: 'archetype-smooth-operator',
    displayName: 'Velvet',
  },
  'archetype-groove-seeker': {
    id: 'archetype-groove-seeker',
    displayName: 'Bounce',
  },
  'archetype-culture-curator': {
    id: 'archetype-culture-curator',
    displayName: 'Root',
  },
  'archetype-eclectic': {
    id: 'archetype-eclectic',
    displayName: 'Prism',
  },
  'archetype-uncharted': {
    id: 'archetype-uncharted',
    displayName: 'Compass',
  },
})

/**
 * Resolve an archetype id to its short display name (R9.6).
 *
 * Returns the raw id for unknown archetypes so the caller can render
 * something rather than crash; surfaces are expected to emit a
 * non-blocking observability warning (R9.10).
 *
 * R9.13: this function intentionally takes only an id. Do not add a
 * locale parameter.
 */
export function getArchetypeDisplayName(id: string): string {
  return ARCHETYPE_NAMES[id]?.displayName ?? id
}

/**
 * Resolve an archetype id to its etymology copy (R9.12).
 *
 * Returns `undefined` for archetypes whose names do not require an
 * etymology line (i.e. all English names).
 */
export function getArchetypeEtymology(id: string): string | undefined {
  return ARCHETYPE_NAMES[id]?.etymology
}
