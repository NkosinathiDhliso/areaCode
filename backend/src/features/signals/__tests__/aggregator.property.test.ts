/**
 * Property Tests for Confidence Scoring and Consensus (Properties 4, 5, 6, 12, 13)
 *
 * Property 4: Confidence Score Bounds and Monotonicity
 * Property 5: Decay Function TTL Enforcement
 * Property 6: Consensus Selection Correctness
 * Property 12: Tier-to-Weight Mapping
 * Property 13: Single-User Confidence Cap
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 10.1, 10.6**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  computeConfidence,
  computeConsensus,
  computeDecay,
  getReporterWeight,
  getSignalTtlMs,
  TIERS,
  type Tier,
} from '../aggregator'
import type { SignalRecord } from '../types'

// ============================================================================
// Constants (mirrored from aggregator for test assertions)
// ============================================================================

const GENRE_TTL_MS = 60 * 60 * 1000 // 60 minutes
const QUEUE_TTL_MS = 30 * 60 * 1000 // 30 minutes

const EXPECTED_TIER_WEIGHTS: Record<Tier, number> = {
  legend: 2.0,
  institution: 1.8,
  fixture: 1.5,
  regular: 1.2,
  local: 1.0,
}

// ============================================================================
// Custom Arbitraries
// ============================================================================

/** Arbitrary that produces one of the 5 valid Tier values */
const tierArb = fc.constantFrom(...TIERS)

/** Arbitrary for signal type */
const signalTypeArb = fc.constantFrom('genre_playing' as const, 'queue_length' as const)

/** Arbitrary for reporter weight (based on tier weights, range 0.1 to 2.0) */
const reporterWeightArb = fc.double({ min: 0.1, max: 2.0, noNaN: true })

/** Arbitrary for a time offset in ms within a signal's TTL */
const withinGenreTtlArb = fc.double({ min: 0, max: GENRE_TTL_MS - 1, noNaN: true })
const withinQueueTtlArb = fc.double({ min: 0, max: QUEUE_TTL_MS - 1, noNaN: true })

/** Arbitrary for a time offset at or beyond TTL */
const beyondGenreTtlArb = fc.double({ min: GENRE_TTL_MS, max: GENRE_TTL_MS * 10, noNaN: true })
const beyondQueueTtlArb = fc.double({ min: QUEUE_TTL_MS, max: QUEUE_TTL_MS * 10, noNaN: true })

/** Arbitrary for a positive age in ms (used for general recency tests) */
const positiveAgeArb = fc.double({ min: 1, max: GENRE_TTL_MS * 2, noNaN: true })

/**
 * Generates a SignalRecord with configurable properties.
 * The `now` reference time is fixed; `ageMs` determines how old the signal is.
 */
function signalRecordArb(options?: {
  type?: 'genre_playing' | 'queue_length'
  isProximity?: boolean
  isOwner?: boolean
}) {
  return fc.record({
    signalId: fc.uuid(),
    nodeId: fc.uuid(),
    userId: fc.uuid(),
    type: fc.constant(options?.type ?? 'genre_playing'),
    value: fc.constant('amapiano'),
    reporterWeight: reporterWeightArb,
    isProximity: fc.constant(options?.isProximity ?? false),
    isOwner: fc.constant(options?.isOwner ?? false),
    createdAt: fc.constant(''), // will be set dynamically in tests
  })
}

/** Full arbitrary SignalRecord with random properties */
const fullSignalRecordArb = fc.record({
  signalId: fc.uuid(),
  nodeId: fc.uuid(),
  userId: fc.uuid(),
  type: signalTypeArb,
  value: fc.constant('amapiano'),
  reporterWeight: reporterWeightArb,
  isProximity: fc.boolean(),
  isOwner: fc.boolean(),
  createdAt: fc.constant(''), // placeholder, set in tests
})

/**
 * Helper: creates a signal with a specific age relative to `now`.
 */
function makeSignalWithAge(
  base: SignalRecord,
  ageMs: number,
  now: Date,
): SignalRecord {
  const createdAt = new Date(now.getTime() - ageMs)
  return { ...base, createdAt: createdAt.toISOString() }
}

// ============================================================================
// Property 4: Confidence Score Bounds and Monotonicity
// ============================================================================

describe('Feature: venue-live-signals, Property 4: Confidence Score Bounds and Monotonicity', () => {
  const now = new Date('2025-01-15T12:00:00.000Z')

  describe('score is always between 0.0 and 1.0', () => {
    it('confidence score is within [0, 1] for any valid signal', () => {
      fc.assert(
        fc.property(
          fullSignalRecordArb,
          positiveAgeArb,
          (signal, ageMs) => {
            const s = makeSignalWithAge(signal, ageMs, now)
            const score = computeConfidence(s, now)
            expect(score).toBeGreaterThanOrEqual(0.0)
            expect(score).toBeLessThanOrEqual(1.0)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('confidence score is 0 or positive for zero-age signals', () => {
      fc.assert(
        fc.property(fullSignalRecordArb, (signal) => {
          const s = makeSignalWithAge(signal, 0, now)
          const score = computeConfidence(s, now)
          expect(score).toBeGreaterThanOrEqual(0.0)
          expect(score).toBeLessThanOrEqual(1.0)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('more recent signals score higher or equal', () => {
    it('a more recent genre signal has higher or equal confidence than an older one', () => {
      fc.assert(
        fc.property(
          signalRecordArb({ type: 'genre_playing' }),
          fc.double({ min: 1, max: GENRE_TTL_MS - 1, noNaN: true }),
          fc.double({ min: 1, max: GENRE_TTL_MS - 1, noNaN: true }),
          (baseSignal, age1, age2) => {
            const recentAge = Math.min(age1, age2)
            const olderAge = Math.max(age1, age2)

            const recentSignal = makeSignalWithAge(baseSignal, recentAge, now)
            const olderSignal = makeSignalWithAge(baseSignal, olderAge, now)

            const recentScore = computeConfidence(recentSignal, now)
            const olderScore = computeConfidence(olderSignal, now)

            expect(recentScore).toBeGreaterThanOrEqual(olderScore)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('a more recent queue signal has higher or equal confidence than an older one', () => {
      fc.assert(
        fc.property(
          signalRecordArb({ type: 'queue_length' }),
          fc.double({ min: 1, max: QUEUE_TTL_MS - 1, noNaN: true }),
          fc.double({ min: 1, max: QUEUE_TTL_MS - 1, noNaN: true }),
          (baseSignal, age1, age2) => {
            const recentAge = Math.min(age1, age2)
            const olderAge = Math.max(age1, age2)

            const recentSignal = makeSignalWithAge(baseSignal, recentAge, now)
            const olderSignal = makeSignalWithAge(baseSignal, olderAge, now)

            const recentScore = computeConfidence(recentSignal, now)
            const olderScore = computeConfidence(olderSignal, now)

            expect(recentScore).toBeGreaterThanOrEqual(olderScore)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('proximity signals score higher or equal', () => {
    it('a proximity signal scores higher or equal than a remote signal (same otherwise)', () => {
      fc.assert(
        fc.property(
          signalRecordArb({ isProximity: false, isOwner: false }),
          fc.double({ min: 1, max: GENRE_TTL_MS - 1, noNaN: true }),
          (baseSignal, ageMs) => {
            const remoteSignal = makeSignalWithAge(
              { ...baseSignal, isProximity: false },
              ageMs,
              now,
            )
            const proximitySignal = makeSignalWithAge(
              { ...baseSignal, isProximity: true },
              ageMs,
              now,
            )

            const remoteScore = computeConfidence(remoteSignal, now)
            const proximityScore = computeConfidence(proximitySignal, now)

            expect(proximityScore).toBeGreaterThanOrEqual(remoteScore)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})

// ============================================================================
// Property 5: Decay Function TTL Enforcement
// ============================================================================

describe('Feature: venue-live-signals, Property 5: Decay Function TTL Enforcement', () => {
  describe('genre signals decay to zero at 60 minutes', () => {
    it('genre signal decay is zero when age >= 60 minutes', () => {
      fc.assert(
        fc.property(beyondGenreTtlArb, (ageMs) => {
          const decay = computeDecay('genre_playing', ageMs)
          expect(decay).toBe(0.0)
        }),
        { numRuns: 100 },
      )
    })

    it('genre signal decay is exactly zero at exactly 60 minutes', () => {
      const decay = computeDecay('genre_playing', GENRE_TTL_MS)
      expect(decay).toBe(0.0)
    })
  })

  describe('queue signals decay to zero at 30 minutes', () => {
    it('queue signal decay is zero when age >= 30 minutes', () => {
      fc.assert(
        fc.property(beyondQueueTtlArb, (ageMs) => {
          const decay = computeDecay('queue_length', ageMs)
          expect(decay).toBe(0.0)
        }),
        { numRuns: 100 },
      )
    })

    it('queue signal decay is exactly zero at exactly 30 minutes', () => {
      const decay = computeDecay('queue_length', QUEUE_TTL_MS)
      expect(decay).toBe(0.0)
    })
  })

  describe('signals have positive decay before TTL', () => {
    it('genre signal decay is positive when age < 60 minutes', () => {
      fc.assert(
        fc.property(withinGenreTtlArb, (ageMs) => {
          const decay = computeDecay('genre_playing', ageMs)
          expect(decay).toBeGreaterThan(0.0)
          expect(decay).toBeLessThanOrEqual(1.0)
        }),
        { numRuns: 100 },
      )
    })

    it('queue signal decay is positive when age < 30 minutes', () => {
      fc.assert(
        fc.property(withinQueueTtlArb, (ageMs) => {
          const decay = computeDecay('queue_length', ageMs)
          expect(decay).toBeGreaterThan(0.0)
          expect(decay).toBeLessThanOrEqual(1.0)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('TTL values are correct', () => {
    it('genre signal TTL is 60 minutes', () => {
      expect(getSignalTtlMs('genre_playing')).toBe(GENRE_TTL_MS)
    })

    it('queue signal TTL is 30 minutes', () => {
      expect(getSignalTtlMs('queue_length')).toBe(QUEUE_TTL_MS)
    })
  })
})

// ============================================================================
// Property 12: Tier-to-Weight Mapping
// ============================================================================

describe('Feature: venue-live-signals, Property 12: Tier-to-Weight Mapping', () => {
  it('all 5 tier values map to their correct weights', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        const weight = getReporterWeight(tier)
        expect(weight).toBe(EXPECTED_TIER_WEIGHTS[tier])
      }),
      { numRuns: 100 },
    )
  })

  it('legend tier maps to 2.0', () => {
    expect(getReporterWeight('legend')).toBe(2.0)
  })

  it('institution tier maps to 1.8', () => {
    expect(getReporterWeight('institution')).toBe(1.8)
  })

  it('fixture tier maps to 1.5', () => {
    expect(getReporterWeight('fixture')).toBe(1.5)
  })

  it('regular tier maps to 1.2', () => {
    expect(getReporterWeight('regular')).toBe(1.2)
  })

  it('local tier maps to 1.0', () => {
    expect(getReporterWeight('local')).toBe(1.0)
  })

  it('no other weight values are assigned for the 5 tiers', () => {
    const validWeights = new Set([2.0, 1.8, 1.5, 1.2, 1.0])
    fc.assert(
      fc.property(tierArb, (tier) => {
        const weight = getReporterWeight(tier)
        expect(validWeights.has(weight)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})

// ============================================================================
// Custom Arbitraries for Consensus Tests
// ============================================================================

/** Valid genre values for genre_playing signals */
const GENRES = [
  'amapiano', 'deep_house', 'afrobeats', 'hip_hop', 'rnb',
  'kwaito', 'gqom', 'jazz', 'rock', 'pop', 'gospel', 'maskandi',
] as const

/** Valid queue values for queue_length signals */
const QUEUE_VALUES = ['none', 'short', 'long'] as const

/** Arbitrary for a valid genre value */
const genreArb = fc.constantFrom(...GENRES)

/** Arbitrary for a valid queue value */
const queueValueArb = fc.constantFrom(...QUEUE_VALUES)

/** Tier weight values for generating realistic reporter weights */
const TIER_WEIGHT_VALUES = [2.0, 1.8, 1.5, 1.2, 1.0] as const
const tierWeightArb = fc.constantFrom(...TIER_WEIGHT_VALUES)

/**
 * Generates a signal record for consensus testing with a specific value,
 * user, and age relative to `now`.
 */
function makeConsensusSignal(opts: {
  nodeId: string
  userId: string
  type: 'genre_playing' | 'queue_length'
  value: string
  reporterWeight: number
  isProximity: boolean
  isOwner: boolean
  ageMs: number
  now: Date
}): SignalRecord {
  const createdAt = new Date(opts.now.getTime() - opts.ageMs)
  return {
    signalId: `sig-${opts.userId}-${opts.value}-${opts.ageMs}`,
    nodeId: opts.nodeId,
    userId: opts.userId,
    type: opts.type,
    value: opts.value,
    reporterWeight: opts.reporterWeight,
    isProximity: opts.isProximity,
    isOwner: opts.isOwner,
    createdAt: createdAt.toISOString(),
  }
}

/**
 * Arbitrary for a set of genre signals from multiple users with varying values.
 * Generates 2-10 signals with random genres, users, weights, and ages within TTL.
 */
const genreSignalSetArb = fc.record({
  nodeId: fc.uuid(),
  signals: fc.array(
    fc.record({
      userId: fc.uuid(),
      value: genreArb,
      reporterWeight: tierWeightArb,
      isProximity: fc.boolean(),
      ageMs: fc.integer({ min: 0, max: GENRE_TTL_MS - 1 }),
    }),
    { minLength: 2, maxLength: 10 },
  ),
})

/**
 * Arbitrary for a set of queue signals from multiple users with varying values.
 */
const queueSignalSetArb = fc.record({
  nodeId: fc.uuid(),
  signals: fc.array(
    fc.record({
      userId: fc.uuid(),
      value: queueValueArb,
      reporterWeight: tierWeightArb,
      isProximity: fc.boolean(),
      ageMs: fc.integer({ min: 0, max: QUEUE_TTL_MS - 1 }),
    }),
    { minLength: 2, maxLength: 10 },
  ),
})

/**
 * Arbitrary for single-user signal sets (Property 13).
 * Generates 1-20 signals all from the same user with max weight and proximity.
 */
const singleUserGenreSignalSetArb = fc.record({
  nodeId: fc.uuid(),
  userId: fc.uuid(),
  value: genreArb,
  reporterWeight: fc.constantFrom(2.0), // legend tier (max weight)
  signalCount: fc.integer({ min: 1, max: 20 }),
  ages: fc.array(
    fc.integer({ min: 0, max: GENRE_TTL_MS - 1 }),
    { minLength: 1, maxLength: 20 },
  ),
})

const singleUserQueueSignalSetArb = fc.record({
  nodeId: fc.uuid(),
  userId: fc.uuid(),
  value: queueValueArb,
  reporterWeight: fc.constantFrom(2.0), // legend tier (max weight)
  signalCount: fc.integer({ min: 1, max: 20 }),
  ages: fc.array(
    fc.integer({ min: 0, max: QUEUE_TTL_MS - 1 }),
    { minLength: 1, maxLength: 20 },
  ),
})

// ============================================================================
// Property 6: Consensus Selection Correctness
// ============================================================================

describe('Feature: venue-live-signals, Property 6: Consensus Selection Correctness', () => {
  /**
   * **Validates: Requirements 5.4, 5.5**
   *
   * Property 6: For any set of signals for the same node and type, the consensus
   * value SHALL be the value with the highest aggregate weighted score. When the
   * highest aggregate weighted score produces a confidence below 0.15, the
   * consensus SHALL be null.
   */
  const now = new Date('2025-01-15T12:00:00.000Z')

  describe('highest aggregate score wins for genre signals', () => {
    it('consensus value is the genre with the highest aggregate weighted score', () => {
      fc.assert(
        fc.property(genreSignalSetArb, ({ nodeId, signals }) => {
          // Build signal records
          const signalRecords: SignalRecord[] = signals.map((s, i) =>
            makeConsensusSignal({
              nodeId,
              userId: s.userId,
              type: 'genre_playing',
              value: s.value,
              reporterWeight: s.reporterWeight,
              isProximity: s.isProximity,
              isOwner: false,
              ageMs: s.ageMs,
              now,
            }),
          )

          const result = computeConsensus(signalRecords, 'genre_playing', now)

          // Manually compute expected aggregate scores per value
          const valueScores = new Map<string, { total: number; userIds: Set<string> }>()
          for (const signal of signalRecords) {
            const confidence = computeConfidence(signal, now)
            if (confidence === 0.0) continue
            const existing = valueScores.get(signal.value)
            if (existing) {
              existing.total += confidence
              existing.userIds.add(signal.userId)
            } else {
              valueScores.set(signal.value, {
                total: confidence,
                userIds: new Set([signal.userId]),
              })
            }
          }

          if (valueScores.size === 0) {
            // All signals decayed — consensus should be null
            expect(result.consensusValue).toBeNull()
            return
          }

          // Find the winning value (highest aggregate score)
          let expectedWinner: string | null = null
          let highestScore = 0.0
          for (const [value, group] of valueScores) {
            if (group.total > highestScore) {
              highestScore = group.total
              expectedWinner = value
            }
          }

          // Apply single-user cap if applicable
          const winnerGroup = valueScores.get(expectedWinner!)!
          if (winnerGroup.userIds.size === 1 && highestScore >= 0.7) {
            highestScore = 0.69
          }

          // Check threshold
          if (highestScore < 0.15) {
            expect(result.consensusValue).toBeNull()
          } else {
            expect(result.consensusValue).toBe(expectedWinner)
          }
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('highest aggregate score wins for queue signals', () => {
    it('consensus value is the queue value with the highest aggregate weighted score', () => {
      fc.assert(
        fc.property(queueSignalSetArb, ({ nodeId, signals }) => {
          const signalRecords: SignalRecord[] = signals.map((s) =>
            makeConsensusSignal({
              nodeId,
              userId: s.userId,
              type: 'queue_length',
              value: s.value,
              reporterWeight: s.reporterWeight,
              isProximity: s.isProximity,
              isOwner: false,
              ageMs: s.ageMs,
              now,
            }),
          )

          const result = computeConsensus(signalRecords, 'queue_length', now)

          // Manually compute expected aggregate scores per value
          const valueScores = new Map<string, { total: number; userIds: Set<string> }>()
          for (const signal of signalRecords) {
            const confidence = computeConfidence(signal, now)
            if (confidence === 0.0) continue
            const existing = valueScores.get(signal.value)
            if (existing) {
              existing.total += confidence
              existing.userIds.add(signal.userId)
            } else {
              valueScores.set(signal.value, {
                total: confidence,
                userIds: new Set([signal.userId]),
              })
            }
          }

          if (valueScores.size === 0) {
            expect(result.consensusValue).toBeNull()
            return
          }

          let expectedWinner: string | null = null
          let highestScore = 0.0
          for (const [value, group] of valueScores) {
            if (group.total > highestScore) {
              highestScore = group.total
              expectedWinner = value
            }
          }

          const winnerGroup = valueScores.get(expectedWinner!)!
          if (winnerGroup.userIds.size === 1 && highestScore >= 0.7) {
            highestScore = 0.69
          }

          if (highestScore < 0.15) {
            expect(result.consensusValue).toBeNull()
          } else {
            expect(result.consensusValue).toBe(expectedWinner)
          }
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('consensus is null when below threshold', () => {
    it('returns null consensus when highest aggregate score is below 0.15', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          genreArb,
          // Use ages very close to TTL so confidence is very low
          fc.integer({ min: Math.floor(GENRE_TTL_MS * 0.95), max: GENRE_TTL_MS - 1 }),
          (nodeId, userId, genre, ageMs) => {
            // A single signal near expiry with low weight should produce < 0.15
            const signal = makeConsensusSignal({
              nodeId,
              userId,
              type: 'genre_playing',
              value: genre,
              reporterWeight: 1.0, // lowest tier weight
              isProximity: false,
              isOwner: false,
              ageMs,
              now,
            })

            const confidence = computeConfidence(signal, now)
            // Only assert if the confidence is actually below threshold
            if (confidence < 0.15) {
              const result = computeConsensus([signal], 'genre_playing', now)
              expect(result.consensusValue).toBeNull()
              expect(result.confidenceScore).toBeLessThan(0.15)
            }
          },
        ),
        { numRuns: 100 },
      )
    })

    it('returns null consensus for empty signal array', () => {
      const result = computeConsensus([], 'genre_playing', now)
      expect(result.consensusValue).toBeNull()
      expect(result.confidenceScore).toBe(0.0)
      expect(result.reportCount).toBe(0)
    })

    it('returns null consensus when all signals have fully decayed', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          genreArb,
          fc.integer({ min: GENRE_TTL_MS, max: GENRE_TTL_MS * 5 }),
          (nodeId, userId, genre, ageMs) => {
            const signal = makeConsensusSignal({
              nodeId,
              userId,
              type: 'genre_playing',
              value: genre,
              reporterWeight: 2.0,
              isProximity: true,
              isOwner: false,
              ageMs,
              now,
            })

            const result = computeConsensus([signal], 'genre_playing', now)
            expect(result.consensusValue).toBeNull()
            expect(result.confidenceScore).toBe(0.0)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})

// ============================================================================
// Property 13: Single-User Confidence Cap
// ============================================================================

describe('Feature: venue-live-signals, Property 13: Single-User Confidence Cap', () => {
  /**
   * **Validates: Requirements 5.5, 10.6**
   *
   * Property 13: For any set of signals where all reports come from a single user
   * (regardless of count, tier, or proximity), the resulting Confidence_Score SHALL
   * never reach or exceed 0.7. At least 2 agreeing reports from different users
   * SHALL be required to achieve high confidence (>= 0.7).
   */
  const now = new Date('2025-01-15T12:00:00.000Z')

  describe('single-user signals never reach 0.7 confidence', () => {
    it('genre signals from a single user never produce confidence >= 0.7', () => {
      fc.assert(
        fc.property(singleUserGenreSignalSetArb, ({ nodeId, userId, value, reporterWeight, signalCount, ages }) => {
          // Create multiple signals from the same user
          const count = Math.min(signalCount, ages.length)
          const signals: SignalRecord[] = []
          for (let i = 0; i < count; i++) {
            signals.push(
              makeConsensusSignal({
                nodeId,
                userId,
                type: 'genre_playing',
                value,
                reporterWeight,
                isProximity: true, // max proximity bonus
                isOwner: false,
                ageMs: ages[i],
                now,
              }),
            )
          }

          const result = computeConsensus(signals, 'genre_playing', now)
          expect(result.confidenceScore).toBeLessThan(0.7)
        }),
        { numRuns: 100 },
      )
    })

    it('queue signals from a single user never produce confidence >= 0.7', () => {
      fc.assert(
        fc.property(singleUserQueueSignalSetArb, ({ nodeId, userId, value, reporterWeight, signalCount, ages }) => {
          const count = Math.min(signalCount, ages.length)
          const signals: SignalRecord[] = []
          for (let i = 0; i < count; i++) {
            signals.push(
              makeConsensusSignal({
                nodeId,
                userId,
                type: 'queue_length',
                value,
                reporterWeight,
                isProximity: true,
                isOwner: false,
                ageMs: ages[i],
                now,
              }),
            )
          }

          const result = computeConsensus(signals, 'queue_length', now)
          expect(result.confidenceScore).toBeLessThan(0.7)
        }),
        { numRuns: 100 },
      )
    })

    it('single-user owner signals never produce confidence >= 0.7', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          genreArb,
          fc.integer({ min: 1, max: 20 }),
          fc.array(fc.integer({ min: 0, max: GENRE_TTL_MS - 1 }), { minLength: 1, maxLength: 20 }),
          (nodeId, userId, genre, signalCount, ages) => {
            const count = Math.min(signalCount, ages.length)
            const signals: SignalRecord[] = []
            for (let i = 0; i < count; i++) {
              signals.push(
                makeConsensusSignal({
                  nodeId,
                  userId,
                  type: 'genre_playing',
                  value: genre,
                  reporterWeight: 2.0, // legend tier
                  isProximity: true,
                  isOwner: true, // owner report
                  ageMs: ages[i],
                  now,
                }),
              )
            }

            const result = computeConsensus(signals, 'genre_playing', now)
            expect(result.confidenceScore).toBeLessThan(0.7)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('two different users can achieve high confidence', () => {
    it('two agreeing users with good weight can reach >= 0.7 confidence', () => {
      // This is a deterministic example test to verify the threshold is achievable
      const nodeId = 'node-123'
      const signals: SignalRecord[] = [
        makeConsensusSignal({
          nodeId,
          userId: 'user-1',
          type: 'genre_playing',
          value: 'amapiano',
          reporterWeight: 2.0, // legend
          isProximity: true,
          isOwner: false,
          ageMs: 0, // just submitted
          now,
        }),
        makeConsensusSignal({
          nodeId,
          userId: 'user-2',
          type: 'genre_playing',
          value: 'amapiano',
          reporterWeight: 2.0, // legend
          isProximity: true,
          isOwner: false,
          ageMs: 0, // just submitted
          now,
        }),
      ]

      const result = computeConsensus(signals, 'genre_playing', now)
      // Two legend-tier proximity reports at age 0 should produce high confidence
      // Each contributes: decay(1.0) * (2.0 * 1.5) / 3.0 = 1.0
      // Total = 2.0, clamped to 1.0
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7)
      expect(result.consensusValue).toBe('amapiano')
    })

    it('property: two different users agreeing can achieve >= 0.7 with sufficient weight', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          fc.uuid(),
          genreArb,
          (nodeId, userId1, userId2) => {
            // Ensure different users
            fc.pre(userId1 !== userId2)

            const signals: SignalRecord[] = [
              makeConsensusSignal({
                nodeId,
                userId: userId1,
                type: 'genre_playing',
                value: 'amapiano',
                reporterWeight: 2.0, // legend
                isProximity: true,
                isOwner: false,
                ageMs: 0,
                now,
              }),
              makeConsensusSignal({
                nodeId,
                userId: userId2,
                type: 'genre_playing',
                value: 'amapiano',
                reporterWeight: 2.0, // legend
                isProximity: true,
                isOwner: false,
                ageMs: 0,
                now,
              }),
            ]

            const result = computeConsensus(signals, 'genre_playing', now)
            // Two legend proximity reports at age 0 should exceed 0.7
            expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})

// ============================================================================
// Property 8: Owner Report Tagging and Weight
// ============================================================================

describe('Feature: venue-live-signals, Property 8: Owner Report Tagging and Weight', () => {
  /**
   * **Validates: Requirements 7.1, 7.2**
   *
   * Property 8: For any signal submission where the authenticated user is the
   * business owner of the node, the signal SHALL be tagged as an Owner_Report.
   * Owner_Reports SHALL receive the same effective weight in the confidence
   * calculation as a fixture-tier (1.5) Proximity_Report (1.5× multiplier),
   * regardless of the owner's actual tier.
   */
  const now = new Date('2025-01-15T12:00:00.000Z')

  describe('owner reports produce same confidence as fixture-tier proximity reports', () => {
    it('owner report confidence equals fixture-tier proximity report confidence for any age and signal type', () => {
      fc.assert(
        fc.property(
          fc.uuid(), // nodeId
          fc.uuid(), // ownerUserId
          fc.uuid(), // nonOwnerUserId
          signalTypeArb,
          reporterWeightArb, // owner's actual tier weight (should be ignored)
          fc.double({ min: 0, max: GENRE_TTL_MS - 1, noNaN: true }), // ageMs
          (nodeId, ownerUserId, nonOwnerUserId, type, ownerActualWeight, ageMs) => {
            // For queue signals, cap age within queue TTL
            const effectiveAge = type === 'queue_length'
              ? Math.min(ageMs, QUEUE_TTL_MS - 1)
              : ageMs

            // Owner report with any tier weight
            const ownerSignal = makeSignalWithAge(
              {
                signalId: `sig-owner`,
                nodeId,
                userId: ownerUserId,
                type,
                value: 'amapiano',
                reporterWeight: ownerActualWeight, // should be ignored for owners
                isProximity: false, // proximity flag irrelevant for owners
                isOwner: true,
                createdAt: '',
              },
              effectiveAge,
              now,
            )

            // Fixture-tier proximity report (non-owner)
            const fixtureProximitySignal = makeSignalWithAge(
              {
                signalId: `sig-fixture`,
                nodeId,
                userId: nonOwnerUserId,
                type,
                value: 'amapiano',
                reporterWeight: 1.5, // fixture tier weight
                isProximity: true,
                isOwner: false,
                createdAt: '',
              },
              effectiveAge,
              now,
            )

            const ownerConfidence = computeConfidence(ownerSignal, now)
            const fixtureProximityConfidence = computeConfidence(fixtureProximitySignal, now)

            expect(ownerConfidence).toBe(fixtureProximityConfidence)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('owner actual tier weight is ignored', () => {
    it('owner reports produce identical confidence regardless of reporterWeight value', () => {
      fc.assert(
        fc.property(
          fc.uuid(), // nodeId
          fc.uuid(), // userId
          signalTypeArb,
          fc.double({ min: 0.1, max: 2.0, noNaN: true }), // weight1
          fc.double({ min: 0.1, max: 2.0, noNaN: true }), // weight2
          fc.double({ min: 0, max: GENRE_TTL_MS - 1, noNaN: true }), // ageMs
          (nodeId, userId, type, weight1, weight2, ageMs) => {
            const effectiveAge = type === 'queue_length'
              ? Math.min(ageMs, QUEUE_TTL_MS - 1)
              : ageMs

            const ownerSignal1 = makeSignalWithAge(
              {
                signalId: `sig-1`,
                nodeId,
                userId,
                type,
                value: 'amapiano',
                reporterWeight: weight1,
                isProximity: false,
                isOwner: true,
                createdAt: '',
              },
              effectiveAge,
              now,
            )

            const ownerSignal2 = makeSignalWithAge(
              {
                signalId: `sig-2`,
                nodeId,
                userId,
                type,
                value: 'amapiano',
                reporterWeight: weight2,
                isProximity: true, // even with proximity true, owner weight overrides
                isOwner: true,
                createdAt: '',
              },
              effectiveAge,
              now,
            )

            const confidence1 = computeConfidence(ownerSignal1, now)
            const confidence2 = computeConfidence(ownerSignal2, now)

            expect(confidence1).toBe(confidence2)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('owner effective weight is fixture (1.5) × proximity (1.5) = 2.25', () => {
    it('owner report at age 0 produces confidence equal to 2.25 / maxWeight', () => {
      fc.assert(
        fc.property(
          fc.uuid(), // nodeId
          fc.uuid(), // userId
          signalTypeArb,
          reporterWeightArb, // any tier weight
          (nodeId, userId, type, anyWeight) => {
            // Owner signal at age 0 (full decay = 1.0)
            const ownerSignal = makeSignalWithAge(
              {
                signalId: `sig-owner`,
                nodeId,
                userId,
                type,
                value: 'amapiano',
                reporterWeight: anyWeight,
                isProximity: false,
                isOwner: true,
                createdAt: '',
              },
              0, // age = 0, decay = 1.0
              now,
            )

            const confidence = computeConfidence(ownerSignal, now)

            // Expected: decay(1.0) × ownerEffectiveWeight(2.25) / maxWeight(3.0)
            // = 1.0 × 2.25 / 3.0 = 0.75
            const expectedConfidence = 2.25 / 3.0
            expect(confidence).toBeCloseTo(expectedConfidence, 10)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})
