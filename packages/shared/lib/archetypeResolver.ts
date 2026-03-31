import type {
  MusicGenre,
  DimensionScoreVector,
  PersonalityArchetype,
  GenreWeightEntry,
  PersonalityDimension,
} from '../types'

const DIMENSIONS: PersonalityDimension[] = [
  'energy', 'cultural_rootedness', 'sophistication', 'edge', 'spirituality',
]

/**
 * Compute dimension scores by averaging genre weights across all user genres.
 * Returns null if genres array is empty.
 */
export function computeDimensionScores(
  genres: MusicGenre[],
  weightMatrix: GenreWeightEntry[],
): DimensionScoreVector | null {
  if (genres.length === 0) return null

  const sums: Record<string, number> = {}
  for (const d of DIMENSIONS) sums[d] = 0

  for (const genre of genres) {
    const entry = weightMatrix.find((e) => e.genre === genre)
    if (!entry) continue
    for (const d of DIMENSIONS) {
      sums[d]! += entry.weights[d]
    }
  }

  const result = {} as DimensionScoreVector
  for (const d of DIMENSIONS) {
    result[d] = Math.round((sums[d]! / genres.length) * 1000) / 1000
  }
  return result
}

/**
 * Check if a score vector meets all dimension thresholds for an archetype.
 * Special case: "The Smooth Operator" also requires energy < 0.5.
 */
export function matchesArchetype(
  scores: DimensionScoreVector,
  archetype: PersonalityArchetype,
): boolean {
  for (const [dim, threshold] of Object.entries(archetype.dimensionThresholds)) {
    const score = scores[dim as PersonalityDimension]
    if (score === undefined || score < threshold!) return false
  }

  // Special case: The Smooth Operator requires low energy
  if (archetype.id === 'archetype-smooth-operator' && scores.energy >= 0.5) {
    return false
  }

  return true
}

/**
 * Resolve the highest-priority matching archetype for a given score vector.
 * Returns "The Uncharted" for null scores, "The Eclectic" when no thresholds match.
 */
export function resolveArchetype(
  scores: DimensionScoreVector | null,
  archetypes: PersonalityArchetype[],
): PersonalityArchetype {
  const uncharted = archetypes.find((a) => a.name === 'The Uncharted')
  const eclectic = archetypes.find((a) => a.name === 'The Eclectic')

  if (!scores) {
    return uncharted ?? { id: 'archetype-uncharted', name: 'The Uncharted', iconId: 'uncharted', description: '', dimensionThresholds: {}, priority: 1, isActive: true }
  }

  const active = archetypes
    .filter((a) => a.isActive && a.name !== 'The Eclectic' && a.name !== 'The Uncharted')
    .sort((a, b) => b.priority - a.priority)

  for (const archetype of active) {
    if (Object.keys(archetype.dimensionThresholds).length > 0 && matchesArchetype(scores, archetype)) {
      return archetype
    }
  }

  return eclectic ?? { id: 'archetype-eclectic', name: 'The Eclectic', iconId: 'eclectic', description: '', dimensionThresholds: {}, priority: 2, isActive: true }
}
