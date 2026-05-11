import { describe, it, expect } from 'vitest'
import {
  computeConfidence,
  computeConsensus,
  computeDecay,
  getReporterWeight,
  getSignalTtlMs,
  type Tier,
} from '../aggregator.js'
import type { SignalRecord } from '../types.js'

// ============================================================================
// Helper to create a signal record for testing
// ============================================================================

function makeSignal(overrides: Partial<SignalRecord> = {}): SignalRecord {
  return {
    signalId: 'sig-1',
    nodeId: 'node-1',
    userId: 'user-1',
    type: 'genre_playing',
    value: 'amapiano',
    reporterWeight: 1.0,
    isProximity: false,
    isOwner: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ============================================================================
// getReporterWeight
// ============================================================================

describe('getReporterWeight', () => {
  it('returns 2.0 for legend tier', () => {
    expect(getReporterWeight('legend')).toBe(2.0)
  })

  it('returns 1.8 for institution tier', () => {
    expect(getReporterWeight('institution')).toBe(1.8)
  })

  it('returns 1.5 for fixture tier', () => {
    expect(getReporterWeight('fixture')).toBe(1.5)
  })

  it('returns 1.2 for regular tier', () => {
    expect(getReporterWeight('regular')).toBe(1.2)
  })

  it('returns 1.0 for local tier', () => {
    expect(getReporterWeight('local')).toBe(1.0)
  })
})

// ============================================================================
// computeDecay
// ============================================================================

describe('computeDecay', () => {
  it('returns 1.0 for a brand new signal (age = 0)', () => {
    expect(computeDecay('genre_playing', 0)).toBe(1.0)
  })

  it('returns 0.0 for a genre signal at exactly 60 minutes', () => {
    expect(computeDecay('genre_playing', 60 * 60 * 1000)).toBe(0.0)
  })

  it('returns 0.0 for a genre signal older than 60 minutes', () => {
    expect(computeDecay('genre_playing', 90 * 60 * 1000)).toBe(0.0)
  })

  it('returns 0.0 for a queue signal at exactly 30 minutes', () => {
    expect(computeDecay('queue_length', 30 * 60 * 1000)).toBe(0.0)
  })

  it('returns 0.0 for a queue signal older than 30 minutes', () => {
    expect(computeDecay('queue_length', 45 * 60 * 1000)).toBe(0.0)
  })

  it('returns 0.5 for a genre signal at 30 minutes (half TTL)', () => {
    expect(computeDecay('genre_playing', 30 * 60 * 1000)).toBeCloseTo(0.5)
  })

  it('returns 0.5 for a queue signal at 15 minutes (half TTL)', () => {
    expect(computeDecay('queue_length', 15 * 60 * 1000)).toBeCloseTo(0.5)
  })

  it('returns a positive value for signals within TTL', () => {
    expect(computeDecay('genre_playing', 59 * 60 * 1000)).toBeGreaterThan(0)
    expect(computeDecay('queue_length', 29 * 60 * 1000)).toBeGreaterThan(0)
  })
})

// ============================================================================
// getSignalTtlMs
// ============================================================================

describe('getSignalTtlMs', () => {
  it('returns 60 minutes in ms for genre_playing', () => {
    expect(getSignalTtlMs('genre_playing')).toBe(60 * 60 * 1000)
  })

  it('returns 30 minutes in ms for queue_length', () => {
    expect(getSignalTtlMs('queue_length')).toBe(30 * 60 * 1000)
  })
})

// ============================================================================
// computeConfidence
// ============================================================================

describe('computeConfidence', () => {
  it('returns a value between 0.0 and 1.0', () => {
    const signal = makeSignal({ reporterWeight: 2.0, isProximity: true })
    const confidence = computeConfidence(signal, new Date())
    expect(confidence).toBeGreaterThanOrEqual(0.0)
    expect(confidence).toBeLessThanOrEqual(1.0)
  })

  it('returns 0.0 for a fully decayed genre signal (60+ min old)', () => {
    const now = new Date()
    const createdAt = new Date(now.getTime() - 61 * 60 * 1000)
    const signal = makeSignal({ createdAt: createdAt.toISOString() })
    expect(computeConfidence(signal, now)).toBe(0.0)
  })

  it('returns 0.0 for a fully decayed queue signal (30+ min old)', () => {
    const now = new Date()
    const createdAt = new Date(now.getTime() - 31 * 60 * 1000)
    const signal = makeSignal({
      type: 'queue_length',
      value: 'short',
      createdAt: createdAt.toISOString(),
    })
    expect(computeConfidence(signal, now)).toBe(0.0)
  })

  it('gives higher confidence to proximity reports than remote reports', () => {
    const now = new Date()
    const createdAt = now.toISOString()

    const remoteSignal = makeSignal({ createdAt, reporterWeight: 1.5, isProximity: false })
    const proximitySignal = makeSignal({ createdAt, reporterWeight: 1.5, isProximity: true })

    const remoteConf = computeConfidence(remoteSignal, now)
    const proximityConf = computeConfidence(proximitySignal, now)

    expect(proximityConf).toBeGreaterThan(remoteConf)
  })

  it('gives higher confidence to more recent signals', () => {
    const now = new Date()
    const recentCreatedAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    const olderCreatedAt = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

    const recentSignal = makeSignal({ createdAt: recentCreatedAt, reporterWeight: 1.0 })
    const olderSignal = makeSignal({ createdAt: olderCreatedAt, reporterWeight: 1.0 })

    expect(computeConfidence(recentSignal, now)).toBeGreaterThan(
      computeConfidence(olderSignal, now)
    )
  })

  it('gives higher confidence to higher-tier reporters', () => {
    const now = new Date()
    const createdAt = now.toISOString()

    const localSignal = makeSignal({ createdAt, reporterWeight: 1.0 })
    const legendSignal = makeSignal({ createdAt, reporterWeight: 2.0 })

    expect(computeConfidence(legendSignal, now)).toBeGreaterThan(
      computeConfidence(localSignal, now)
    )
  })

  it('owner reports get same weight as fixture-tier proximity report', () => {
    const now = new Date()
    const createdAt = now.toISOString()

    const ownerSignal = makeSignal({ createdAt, isOwner: true, reporterWeight: 1.0 })
    const fixtureProximitySignal = makeSignal({
      createdAt,
      isOwner: false,
      reporterWeight: 1.5,
      isProximity: true,
    })

    // Owner effective weight = fixture (1.5) × proximity (1.5) = 2.25
    // Fixture proximity weight = 1.5 × 1.5 = 2.25
    expect(computeConfidence(ownerSignal, now)).toBeCloseTo(
      computeConfidence(fixtureProximitySignal, now)
    )
  })

  it('never exceeds 1.0 even with maximum weight and freshest signal', () => {
    const now = new Date()
    const signal = makeSignal({
      createdAt: now.toISOString(),
      reporterWeight: 2.0,
      isProximity: true,
    })
    expect(computeConfidence(signal, now)).toBeLessThanOrEqual(1.0)
  })

  it('returns exactly 1.0 for a legend proximity report at age 0', () => {
    const now = new Date()
    const signal = makeSignal({
      createdAt: now.toISOString(),
      reporterWeight: 2.0,
      isProximity: true,
    })
    // legend (2.0) × proximity (1.5) = 3.0, normalized by max (3.0) = 1.0, decay = 1.0
    expect(computeConfidence(signal, now)).toBe(1.0)
  })
})

// ============================================================================
// computeConsensus
// ============================================================================

describe('computeConsensus', () => {
  const now = new Date('2025-01-15T12:00:00.000Z')

  function makeSignalAt(overrides: Partial<SignalRecord> = {}): SignalRecord {
    return {
      signalId: 'sig-1',
      nodeId: 'node-1',
      userId: 'user-1',
      type: 'genre_playing',
      value: 'amapiano',
      reporterWeight: 1.5,
      isProximity: false,
      isOwner: false,
      createdAt: now.toISOString(),
      ...overrides,
    }
  }

  it('returns null consensus for empty signal array', () => {
    const result = computeConsensus([], 'genre_playing', now)
    expect(result.consensusValue).toBeNull()
    expect(result.confidenceScore).toBe(0.0)
    expect(result.reportCount).toBe(0)
  })

  it('returns null consensus when all signals are fully decayed', () => {
    const oldCreatedAt = new Date(now.getTime() - 90 * 60 * 1000).toISOString()
    const signals = [
      makeSignalAt({ createdAt: oldCreatedAt, value: 'amapiano' }),
      makeSignalAt({ createdAt: oldCreatedAt, value: 'deep_house', userId: 'user-2' }),
    ]
    const result = computeConsensus(signals, 'genre_playing', now)
    expect(result.consensusValue).toBeNull()
    expect(result.confidenceScore).toBe(0.0)
  })

  it('selects the value with the highest aggregate score', () => {
    const signals = [
      // Two reports for amapiano from different users
      makeSignalAt({ value: 'amapiano', userId: 'user-1', reporterWeight: 1.5 }),
      makeSignalAt({ value: 'amapiano', userId: 'user-2', reporterWeight: 1.5 }),
      // One report for deep_house
      makeSignalAt({ value: 'deep_house', userId: 'user-3', reporterWeight: 1.0 }),
    ]
    const result = computeConsensus(signals, 'genre_playing', now)
    expect(result.consensusValue).toBe('amapiano')
    expect(result.reportCount).toBe(2)
  })

  it('returns null consensus when highest score is below 0.15', () => {
    // A single local-tier remote signal that's almost decayed
    const almostDecayed = new Date(now.getTime() - 58 * 60 * 1000).toISOString()
    const signals = [
      makeSignalAt({
        value: 'jazz',
        userId: 'user-1',
        reporterWeight: 1.0,
        isProximity: false,
        createdAt: almostDecayed,
      }),
    ]
    const result = computeConsensus(signals, 'genre_playing', now)
    // local (1.0) / max (3.0) = 0.333, decay at 58/60 = 0.033, confidence ≈ 0.011
    expect(result.consensusValue).toBeNull()
    expect(result.confidenceScore).toBeLessThan(0.15)
  })

  it('enforces single-user confidence cap below 0.7', () => {
    // Multiple fresh signals from the same user with high weight
    const signals = [
      makeSignalAt({ value: 'amapiano', userId: 'user-1', reporterWeight: 2.0, isProximity: true }),
      makeSignalAt({ value: 'amapiano', userId: 'user-1', reporterWeight: 2.0, isProximity: true, signalId: 'sig-2' }),
      makeSignalAt({ value: 'amapiano', userId: 'user-1', reporterWeight: 2.0, isProximity: true, signalId: 'sig-3' }),
    ]
    const result = computeConsensus(signals, 'genre_playing', now)
    // Without cap, score would be 3.0 (3 × 1.0). With cap, it should be < 0.7
    expect(result.confidenceScore).toBeLessThan(0.7)
    expect(result.confidenceScore).toBe(0.69)
    expect(result.consensusValue).toBe('amapiano')
  })

  it('allows >= 0.7 confidence when 2+ different users agree', () => {
    // Two fresh legend proximity signals from different users
    const signals = [
      makeSignalAt({ value: 'amapiano', userId: 'user-1', reporterWeight: 2.0, isProximity: true }),
      makeSignalAt({ value: 'amapiano', userId: 'user-2', reporterWeight: 2.0, isProximity: true, signalId: 'sig-2' }),
    ]
    const result = computeConsensus(signals, 'genre_playing', now)
    // Two legend proximity signals: 2 × 1.0 = 2.0 aggregate score
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7)
    expect(result.consensusValue).toBe('amapiano')
  })

  it('only considers signals matching the requested type', () => {
    const signals = [
      makeSignalAt({ type: 'genre_playing', value: 'amapiano', userId: 'user-1' }),
      makeSignalAt({ type: 'queue_length', value: 'short', userId: 'user-2' }),
    ]
    const genreResult = computeConsensus(signals, 'genre_playing', now)
    const queueResult = computeConsensus(signals, 'queue_length', now)

    expect(genreResult.consensusValue).toBe('amapiano')
    expect(queueResult.consensusValue).toBe('short')
  })

  it('returns correct reportCount for the winning value', () => {
    const signals = [
      makeSignalAt({ value: 'amapiano', userId: 'user-1' }),
      makeSignalAt({ value: 'amapiano', userId: 'user-2', signalId: 'sig-2' }),
      makeSignalAt({ value: 'amapiano', userId: 'user-3', signalId: 'sig-3' }),
      makeSignalAt({ value: 'deep_house', userId: 'user-4', signalId: 'sig-4' }),
    ]
    const result = computeConsensus(signals, 'genre_playing', now)
    expect(result.consensusValue).toBe('amapiano')
    expect(result.reportCount).toBe(3)
  })

  it('returns lastUpdatedAt as ISO string of now', () => {
    const signals = [makeSignalAt({ userId: 'user-1' })]
    const result = computeConsensus(signals, 'genre_playing', now)
    expect(result.lastUpdatedAt).toBe(now.toISOString())
  })
})
