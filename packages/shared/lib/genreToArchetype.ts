import { ARCHETYPE_CATALOG } from '../constants/archetype-catalog'
import { GENRE_WEIGHT_MATRIX } from '../constants/genre-weights'
import type { MusicGenre, PersonalityArchetype } from '../types'

import { computeDimensionScores, resolveArchetype } from './archetypeResolver'

/**
 * Tagged validation error thrown when `genresToArchetype` is called with an
 * input that is structurally invalid (null, undefined, or not an Array/Set).
 *
 * Distinct from the unknown-genre case, which is surfaced as a structured
 * warning on the result rather than an exception (R6.4 vs R6.5).
 */
export class GenreToArchetypeValidationError extends Error {
  public readonly code = 'invalid_input' as const

  constructor(message: string) {
    super(message)
    this.name = 'GenreToArchetypeValidationError'
    // Restore the prototype chain when transpiled to ES5; harmless on modern targets.
    Object.setPrototypeOf(this, GenreToArchetypeValidationError.prototype)
  }
}

/**
 * Structured warning surfaced when one or more inputs are not known genres
 * in `GENRE_WEIGHT_MATRIX`. The function is pure (no console output); the
 * caller is responsible for logging.
 */
export interface GenresToArchetypeWarning {
  code: 'unknown_genre'
  unknownGenres: string[]
}

export interface GenresToArchetypeResult {
  archetype: PersonalityArchetype
  warning?: GenresToArchetypeWarning
}

const UNCHARTED_ID = 'archetype-uncharted'

const KNOWN_GENRES: ReadonlySet<string> = new Set(GENRE_WEIGHT_MATRIX.map((entry) => entry.genre as string))

function getUnchartedArchetype(): PersonalityArchetype {
  return (
    ARCHETYPE_CATALOG.find((a) => a.id === UNCHARTED_ID) ?? {
      id: UNCHARTED_ID,
      name: 'The Uncharted',
      iconId: 'uncharted',
      description: '',
      dimensionThresholds: {},
      priority: 1,
      isActive: true,
    }
  )
}

/**
 * Map a non-empty set of `MusicGenre` values to the highest-priority matching
 * Archetype.
 *
 * Behaviour summary (R6):
 *  - `null` / `undefined` / non-Array, non-Set input → throws
 *    `GenreToArchetypeValidationError` (R6.5).
 *  - Empty input → returns `archetype-uncharted`, no warning (R6.3).
 *  - Any input value not in `GENRE_WEIGHT_MATRIX` → returns
 *    `archetype-uncharted` plus a structured `unknown_genre` warning (R6.4);
 *    the upstream resolvers are NOT invoked.
 *  - Otherwise → calls `computeDimensionScores` + `resolveArchetype` against
 *    `GENRE_WEIGHT_MATRIX` and `ARCHETYPE_CATALOG` (R6.1, R6.2).
 *
 * The function is observably pure: same inputs → same output, no I/O,
 * no global state, no `console`. Order-independence (R6.6) and determinism
 * (R6.7) are inherited from `computeDimensionScores` / `resolveArchetype`.
 */
export function genresToArchetype(genres: MusicGenre[] | Set<MusicGenre>): GenresToArchetypeResult {
  if (genres === null || genres === undefined) {
    throw new GenreToArchetypeValidationError('genresToArchetype: input must be a non-null Array or Set of MusicGenre')
  }

  const isArray = Array.isArray(genres)
  const isSet = genres instanceof Set
  if (!isArray && !isSet) {
    throw new GenreToArchetypeValidationError('genresToArchetype: input must be an Array or Set of MusicGenre')
  }

  const list: MusicGenre[] = isArray ? (genres as MusicGenre[]).slice() : Array.from(genres as Set<MusicGenre>)

  if (list.length === 0) {
    return { archetype: getUnchartedArchetype() }
  }

  const seenUnknown = new Set<string>()
  const unknown: string[] = []
  for (const g of list) {
    if (!KNOWN_GENRES.has(g as unknown as string)) {
      const key = String(g)
      if (!seenUnknown.has(key)) {
        seenUnknown.add(key)
        unknown.push(key)
      }
    }
  }

  if (unknown.length > 0) {
    return {
      archetype: getUnchartedArchetype(),
      warning: { code: 'unknown_genre', unknownGenres: unknown },
    }
  }

  const scores = computeDimensionScores(list, GENRE_WEIGHT_MATRIX)
  const archetype = resolveArchetype(scores, ARCHETYPE_CATALOG)
  return { archetype }
}
