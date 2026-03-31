import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { computeDimensionScores, resolveArchetype, matchesArchetype } from '../archetypeResolver'
import { GENRE_WEIGHT_MATRIX } from '../../constants/genre-weights'
import { ARCHETYPE_CATALOG } from '../../constants/archetype-catalog'
import type { MusicGenre, DimensionScoreVector, PersonalityArchetype } from '../../types'

const ALL_GENRES: MusicGenre[] = [
  'amapiano', 'deep_house', 'afrobeats', 'hip_hop', 'rnb',
  'kwaito', 'gqom', 'jazz', 'rock', 'pop', 'gospel', 'maskandi',
]

const genreArb = fc.constantFrom(...ALL_GENRES)
const genreSetArb = fc.uniqueArray(genreArb, { minLength: 1, maxLength: 5 })

// --- computeDimensionScores ---

describe('computeDimensionScores', () => {
  it('returns null for empty genres', () => {
    expect(computeDimensionScores([], GENRE_WEIGHT_MATRIX)).toBeNull()
  })

  it('returns correct scores for a single genre', () => {
    const result = computeDimensionScores(['jazz'], GENRE_WEIGHT_MATRIX)
    expect(result).not.toBeNull()
    expect(result!.energy).toBeCloseTo(0.3)
    expect(result!.sophistication).toBeCloseTo(0.9)
    expect(result!.spirituality).toBeCloseTo(0.7)
  })

  it('averages scores for multiple genres', () => {
    // amapiano: energy 0.9, jazz: energy 0.3 → average 0.6
    const result = computeDimensionScores(['amapiano', 'jazz'], GENRE_WEIGHT_MATRIX)
    expect(result).not.toBeNull()
    expect(result!.energy).toBeCloseTo(0.6)
  })

  /**
   * Property: All dimension scores are between 0.0 and 1.0 for any valid genre set.
   * Validates: Requirements 8.2
   */
  it('all dimension scores are between 0.0 and 1.0', () => {
    fc.assert(
      fc.property(genreSetArb, (genres) => {
        const result = computeDimensionScores(genres, GENRE_WEIGHT_MATRIX)
        expect(result).not.toBeNull()
        for (const val of Object.values(result!)) {
          expect(val).toBeGreaterThanOrEqual(0.0)
          expect(val).toBeLessThanOrEqual(1.0)
        }
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Property: Scores are the average of genre weights (consistency).
   * Validates: Requirements 8.1, 8.4
   */
  it('scores equal the average of genre weights for each dimension', () => {
    fc.assert(
      fc.property(genreSetArb, (genres) => {
        const result = computeDimensionScores(genres, GENRE_WEIGHT_MATRIX)
        expect(result).not.toBeNull()
        const lookup = new Map(GENRE_WEIGHT_MATRIX.map((e) => [e.genre, e.weights]))
        for (const dim of ['energy', 'cultural_rootedness', 'sophistication', 'edge', 'spirituality'] as const) {
          const expected = genres.reduce((sum, g) => sum + (lookup.get(g)?.[dim] ?? 0), 0) / genres.length
          expect(result![dim]).toBeCloseTo(expected, 3)
        }
      }),
      { numRuns: 200 },
    )
  })
})

// --- matchesArchetype ---

describe('matchesArchetype', () => {
  const highScores: DimensionScoreVector = {
    energy: 0.9, cultural_rootedness: 0.9, sophistication: 0.9, edge: 0.9, spirituality: 0.9,
  }
  const lowScores: DimensionScoreVector = {
    energy: 0.1, cultural_rootedness: 0.1, sophistication: 0.1, edge: 0.1, spirituality: 0.1,
  }

  it('returns true when all thresholds are met', () => {
    const grooveSeeker = ARCHETYPE_CATALOG.find((a) => a.name === 'The Groove Seeker')!
    expect(matchesArchetype(highScores, grooveSeeker)).toBe(true)
  })

  it('returns false when a threshold is not met', () => {
    const grooveSeeker = ARCHETYPE_CATALOG.find((a) => a.name === 'The Groove Seeker')!
    expect(matchesArchetype(lowScores, grooveSeeker)).toBe(false)
  })

  it('handles The Smooth Operator special case — requires energy < 0.5', () => {
    const smoothOp = ARCHETYPE_CATALOG.find((a) => a.name === 'The Smooth Operator')!
    // High sophistication but high energy → should NOT match
    const highEnergy: DimensionScoreVector = {
      energy: 0.8, cultural_rootedness: 0.1, sophistication: 0.9, edge: 0.1, spirituality: 0.1,
    }
    expect(matchesArchetype(highEnergy, smoothOp)).toBe(false)

    // High sophistication and low energy → should match
    const lowEnergy: DimensionScoreVector = {
      energy: 0.3, cultural_rootedness: 0.1, sophistication: 0.9, edge: 0.1, spirituality: 0.1,
    }
    expect(matchesArchetype(lowEnergy, smoothOp)).toBe(true)
  })

  it('returns true for archetype with empty thresholds (except Smooth Operator)', () => {
    const eclectic = ARCHETYPE_CATALOG.find((a) => a.name === 'The Eclectic')!
    expect(matchesArchetype(lowScores, eclectic)).toBe(true)
  })
})

// --- resolveArchetype ---

describe('resolveArchetype', () => {
  it('returns The Uncharted for null scores', () => {
    const result = resolveArchetype(null, ARCHETYPE_CATALOG)
    expect(result.name).toBe('The Uncharted')
  })

  it('returns The Eclectic when no thresholds match', () => {
    const lowScores: DimensionScoreVector = {
      energy: 0.1, cultural_rootedness: 0.1, sophistication: 0.1, edge: 0.1, spirituality: 0.1,
    }
    const result = resolveArchetype(lowScores, ARCHETYPE_CATALOG)
    expect(result.name).toBe('The Eclectic')
  })

  it('returns highest-priority matching archetype', () => {
    // Scores that match Festival Spirit (priority 15): energy >= 0.7, cultural_rootedness >= 0.6, edge >= 0.4
    const scores: DimensionScoreVector = {
      energy: 0.9, cultural_rootedness: 0.9, sophistication: 0.9, edge: 0.9, spirituality: 0.9,
    }
    const result = resolveArchetype(scores, ARCHETYPE_CATALOG)
    expect(result.name).toBe('The Festival Spirit')
  })

  it('skips inactive archetypes', () => {
    const modified = ARCHETYPE_CATALOG.map((a) =>
      a.name === 'The Festival Spirit' ? { ...a, isActive: false } : a,
    )
    const scores: DimensionScoreVector = {
      energy: 0.9, cultural_rootedness: 0.9, sophistication: 0.9, edge: 0.9, spirituality: 0.9,
    }
    const result = resolveArchetype(scores, modified)
    expect(result.name).not.toBe('The Festival Spirit')
    expect(result.name).toBe('The Conscious Creative')
  })

  it('resolves The Smooth Operator for high sophistication + low energy', () => {
    const scores: DimensionScoreVector = {
      energy: 0.3, cultural_rootedness: 0.1, sophistication: 0.8, edge: 0.1, spirituality: 0.1,
    }
    const result = resolveArchetype(scores, ARCHETYPE_CATALOG)
    expect(result.name).toBe('The Smooth Operator')
  })

  /**
   * Property: resolveArchetype always returns exactly one archetype (determinism).
   * Validates: Requirements 10.6
   */
  it('always returns exactly one archetype for any valid score vector', () => {
    const dimArb = fc.double({ min: 0, max: 1, noNaN: true })
    const scoreArb = fc.record({
      energy: dimArb,
      cultural_rootedness: dimArb,
      sophistication: dimArb,
      edge: dimArb,
      spirituality: dimArb,
    }) as fc.Arbitrary<DimensionScoreVector>

    fc.assert(
      fc.property(scoreArb, (scores) => {
        const result = resolveArchetype(scores, ARCHETYPE_CATALOG)
        expect(result).toBeDefined()
        expect(result.name).toBeTruthy()
        expect(result.id).toBeTruthy()
      }),
      { numRuns: 500 },
    )
  })

  /**
   * Property: null scores always resolve to The Uncharted.
   * Validates: Requirements 10.5
   */
  it('null scores always resolve to The Uncharted', () => {
    const result = resolveArchetype(null, ARCHETYPE_CATALOG)
    expect(result.name).toBe('The Uncharted')
  })
})
