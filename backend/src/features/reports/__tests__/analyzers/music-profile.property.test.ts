import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { analyzeMusicProfile } from '../../analyzers/music-profile.js'
import type { MusicPrefs } from '../../types.js'

/**
 * Property 6: Music Profile Aggregation Correctness
 *
 * For any set of visitor music preferences with at least 5 visitors:
 * - Each archetype dimension = average of that dimension across all input visitors
 * - Top genres list sorted by visitor count descending with length ≤ 5
 * - When fewer than 5 visitors have music preferences, hasInsufficientData = true
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */

// ─── Custom Arbitraries ─────────────────────────────────────────────────────

const ARCHETYPE_DIMENSIONS = ['energy', 'cultural_rootedness', 'sophistication', 'edge', 'spirituality'] as const

const GENRE_POOL = [
  'amapiano',
  'house',
  'hip-hop',
  'jazz',
  'rock',
  'pop',
  'r&b',
  'afrobeats',
  'kwaito',
  'gqom',
  'classical',
  'electronic',
  'reggae',
] as const

/** Generate a 64-char hex string (SHA-256 hash format) */
const hexTokenArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))

/** Generate music preferences with dimension scores 0–100 and 1–5 genres */
const musicPrefsArb: fc.Arbitrary<MusicPrefs> = fc.record({
  energy: fc.double({ min: 0, max: 100, noNaN: true }),
  cultural_rootedness: fc.double({ min: 0, max: 100, noNaN: true }),
  sophistication: fc.double({ min: 0, max: 100, noNaN: true }),
  edge: fc.double({ min: 0, max: 100, noNaN: true }),
  spirituality: fc.double({ min: 0, max: 100, noNaN: true }),
  genres: fc.uniqueArray(fc.constantFrom(...GENRE_POOL), { minLength: 1, maxLength: 5 }),
})

/**
 * Generate a list of unique visitor IDs and a music prefs map where
 * all visitors have music preferences (sufficient data scenario).
 */
function sufficientDataArb() {
  return fc
    .array(hexTokenArb, { minLength: 5, maxLength: 50 })
    .chain((tokens) => {
      // Deduplicate tokens
      const uniqueTokens = [...new Set(tokens)]
      if (uniqueTokens.length < 5) {
        // Ensure at least 5 unique tokens
        return fc.constant({ visitorIds: [] as string[], musicPrefsMap: new Map<string, MusicPrefs>() })
      }
      return fc
        .tuple(
          fc.constant(uniqueTokens),
          fc.array(musicPrefsArb, { minLength: uniqueTokens.length, maxLength: uniqueTokens.length }),
        )
        .map(([ids, prefs]) => {
          const map = new Map<string, MusicPrefs>()
          for (let i = 0; i < ids.length; i++) {
            map.set(ids[i]!, prefs[i]!)
          }
          return { visitorIds: ids, musicPrefsMap: map }
        })
    })
    .filter((data) => data.visitorIds.length >= 5)
}

/**
 * Generate a list of visitor IDs where fewer than 5 have music preferences
 * (insufficient data scenario).
 */
function insufficientDataArb() {
  return (
    fc
      .record({
        withPrefs: fc.integer({ min: 0, max: 4 }),
        withoutPrefs: fc.integer({ min: 0, max: 20 }),
      })
      .chain(({ withPrefs, withoutPrefs }) => {
        const totalWithPrefs = withPrefs
        const totalWithout = withoutPrefs
        return fc
          .tuple(
            fc.array(hexTokenArb, {
              minLength: totalWithPrefs + totalWithout,
              maxLength: totalWithPrefs + totalWithout,
            }),
            fc.array(musicPrefsArb, { minLength: totalWithPrefs, maxLength: totalWithPrefs }),
          )
          .map(([allTokens, prefs]) => {
            const uniqueTokens = [...new Set(allTokens)]
            const map = new Map<string, MusicPrefs>()
            // Only assign prefs to the first `totalWithPrefs` unique tokens
            const tokensWithPrefs = uniqueTokens.slice(0, totalWithPrefs)
            for (let i = 0; i < tokensWithPrefs.length && i < prefs.length; i++) {
              map.set(tokensWithPrefs[i]!, prefs[i]!)
            }
            return { visitorIds: uniqueTokens, musicPrefsMap: map }
          })
      })
      // Ensure fewer than 5 visitors actually have prefs in the map
      .filter((data) => {
        let count = 0
        for (const id of data.visitorIds) {
          if (data.musicPrefsMap.has(id)) count++
        }
        return count < 5
      })
  )
}

// ─── Property 6: Music Profile Aggregation Correctness ──────────────────────

describe('Feature: venue-intelligence-reports, Property 6: Music Profile Aggregation Correctness', () => {
  it('each archetype dimension equals the average across all visitors with prefs', () => {
    /**
     * **Validates: Requirements 4.1**
     */
    fc.assert(
      fc.property(sufficientDataArb(), ({ visitorIds, musicPrefsMap }) => {
        const result = analyzeMusicProfile(visitorIds, musicPrefsMap)

        // Manually compute expected averages
        const visitorsWithPrefs: MusicPrefs[] = []
        for (const id of visitorIds) {
          const prefs = musicPrefsMap.get(id)
          if (prefs) visitorsWithPrefs.push(prefs)
        }

        for (const dim of ARCHETYPE_DIMENSIONS) {
          let sum = 0
          for (const prefs of visitorsWithPrefs) {
            sum += prefs[dim]
          }
          const expectedAvg = sum / visitorsWithPrefs.length
          expect(result.archetypeDimensions[dim]).toBeCloseTo(expectedAvg, 5)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('top genres are sorted descending by visitor count with length ≤ 5', () => {
    /**
     * **Validates: Requirements 4.2**
     */
    fc.assert(
      fc.property(sufficientDataArb(), ({ visitorIds, musicPrefsMap }) => {
        const result = analyzeMusicProfile(visitorIds, musicPrefsMap)

        // Length constraint
        expect(result.topGenres.length).toBeLessThanOrEqual(5)

        // Sorted descending by visitorCount
        for (let i = 1; i < result.topGenres.length; i++) {
          expect(result.topGenres[i]!.visitorCount).toBeLessThanOrEqual(result.topGenres[i - 1]!.visitorCount)
        }

        // Verify visitor counts are correct
        const genreCounts = new Map<string, number>()
        for (const id of visitorIds) {
          const prefs = musicPrefsMap.get(id)
          if (prefs) {
            const uniqueGenres = new Set(prefs.genres)
            for (const genre of uniqueGenres) {
              genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
            }
          }
        }

        for (const { genre, visitorCount } of result.topGenres) {
          expect(visitorCount).toBe(genreCounts.get(genre))
        }
      }),
      { numRuns: 100 },
    )
  })

  it('returns hasInsufficientData = true when fewer than 5 visitors have music prefs', () => {
    /**
     * **Validates: Requirements 4.3**
     */
    fc.assert(
      fc.property(insufficientDataArb(), ({ visitorIds, musicPrefsMap }) => {
        const result = analyzeMusicProfile(visitorIds, musicPrefsMap)

        expect(result.hasInsufficientData).toBe(true)
        expect(result.topGenres).toEqual([])
        expect(result.archetypeDimensions).toEqual({})
      }),
      { numRuns: 100 },
    )
  })

  it('returns hasInsufficientData = false when 5 or more visitors have music prefs', () => {
    /**
     * **Validates: Requirements 4.1, 4.2, 4.3**
     */
    fc.assert(
      fc.property(sufficientDataArb(), ({ visitorIds, musicPrefsMap }) => {
        const result = analyzeMusicProfile(visitorIds, musicPrefsMap)
        expect(result.hasInsufficientData).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})
