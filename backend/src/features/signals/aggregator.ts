import type { SignalRecord, ConsensusResult } from './types.js'

// ============================================================================
// Tier Types and Weight Mapping
// ============================================================================

export const TIERS = ['legend', 'institution', 'fixture', 'regular', 'local'] as const

export type Tier = (typeof TIERS)[number]

const TIER_WEIGHTS: Record<Tier, number> = {
  legend: 2.0,
  institution: 1.8,
  fixture: 1.5,
  regular: 1.2,
  local: 1.0,
}

// ============================================================================
// Constants
// ============================================================================

/** Genre signals decay to zero confidence after 60 minutes */
const GENRE_TTL_MS = 60 * 60 * 1000

/** Queue signals decay to zero confidence after 30 minutes */
const QUEUE_TTL_MS = 30 * 60 * 1000

/** Proximity reports receive a 1.5x multiplier */
const PROXIMITY_MULTIPLIER = 1.5

/**
 * Owner reports receive the same effective weight as a fixture-tier proximity report.
 * That means: fixture weight (1.5) × proximity multiplier (1.5) = 2.25
 */
const OWNER_EFFECTIVE_WEIGHT = TIER_WEIGHTS.fixture * PROXIMITY_MULTIPLIER

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Returns the reporter weight for a given tier.
 *
 * Mapping:
 * - legend: 2.0
 * - institution: 1.8
 * - fixture: 1.5
 * - regular: 1.2
 * - local: 1.0
 */
export function getReporterWeight(tier: Tier): number {
  return TIER_WEIGHTS[tier]
}

/**
 * Computes the TTL in milliseconds for a given signal type.
 */
export function getSignalTtlMs(type: 'genre_playing' | 'queue_length'): number {
  return type === 'genre_playing' ? GENRE_TTL_MS : QUEUE_TTL_MS
}

/**
 * Computes the recency decay factor for a signal.
 *
 * Returns a value between 0.0 and 1.0:
 * - 1.0 when the signal was just created (age = 0)
 * - 0.0 when the signal has reached or exceeded its TTL
 * - Linear decay between 0 and TTL
 *
 * This is a pure function with no side effects.
 */
export function computeDecay(
  signalType: 'genre_playing' | 'queue_length',
  ageMs: number
): number {
  const ttl = getSignalTtlMs(signalType)

  if (ageMs >= ttl) {
    return 0.0
  }

  if (ageMs <= 0) {
    return 1.0
  }

  return 1.0 - ageMs / ttl
}

/**
 * Computes the confidence score for a single signal at a given point in time.
 *
 * The confidence score is always between 0.0 and 1.0 and is computed as:
 *   confidence = clamp(decay × effectiveWeight / normalizationFactor, 0, 1)
 *
 * Where effectiveWeight accounts for:
 * - Reporter tier weight (from reporterWeight field on the signal)
 * - Proximity multiplier (1.5x for proximity reports)
 * - Owner override (owner reports get fixture × proximity = 2.25 effective weight)
 *
 * The normalization factor ensures the score stays within [0, 1] even for
 * the highest possible weight (legend tier + proximity = 2.0 × 1.5 = 3.0).
 *
 * This is a pure function with no side effects.
 */
export function computeConfidence(signal: SignalRecord, now: Date): number {
  const createdAt = new Date(signal.createdAt)
  const ageMs = now.getTime() - createdAt.getTime()

  // Compute recency decay
  const decay = computeDecay(signal.type, ageMs)

  // If fully decayed, confidence is zero
  if (decay === 0.0) {
    return 0.0
  }

  // Compute effective weight
  let effectiveWeight: number

  if (signal.isOwner) {
    // Owner reports get the same weight as a fixture-tier proximity report
    effectiveWeight = OWNER_EFFECTIVE_WEIGHT
  } else {
    effectiveWeight = signal.reporterWeight
    if (signal.isProximity) {
      effectiveWeight *= PROXIMITY_MULTIPLIER
    }
  }

  // Normalize to [0, 1] range
  // Max possible weight is legend (2.0) × proximity (1.5) = 3.0
  const maxPossibleWeight = TIER_WEIGHTS.legend * PROXIMITY_MULTIPLIER
  const normalizedWeight = effectiveWeight / maxPossibleWeight

  // Final confidence = decay × normalized weight, clamped to [0, 1]
  const confidence = decay * normalizedWeight

  return Math.max(0.0, Math.min(1.0, confidence))
}

// ============================================================================
// Consensus Constants
// ============================================================================

/** V1 display threshold — consensus below this is treated as null */
const CONSENSUS_THRESHOLD = 0.15

/** Single-user confidence cap — one user alone can never reach this */
const SINGLE_USER_CAP = 0.7

// ============================================================================
// Consensus Computation
// ============================================================================

/**
 * Computes the consensus for a set of signals of the same type at a given node.
 *
 * Algorithm:
 * 1. Compute the confidence score for each signal using computeConfidence
 * 2. Group signals by value and sum their confidence scores per value
 * 3. The value with the highest aggregate score wins
 * 4. If the highest aggregate score is below CONSENSUS_THRESHOLD (0.15), return null consensus
 * 5. If all signals contributing to the winning value come from a single user,
 *    cap the confidence at just below SINGLE_USER_CAP (0.7)
 *
 * This is a pure function with no side effects.
 */
export function computeConsensus(
  signals: SignalRecord[],
  type: 'genre_playing' | 'queue_length',
  now: Date
): ConsensusResult {
  // Filter signals to only those matching the requested type
  const relevantSignals = signals.filter((s) => s.type === type)

  // If no signals, return null consensus
  if (relevantSignals.length === 0) {
    return {
      consensusValue: null,
      confidenceScore: 0.0,
      reportCount: 0,
      lastUpdatedAt: now.toISOString(),
    }
  }

  // Compute confidence for each signal and group by value
  const valueGroups = new Map<
    string,
    { totalScore: number; userIds: Set<string>; count: number }
  >()

  for (const signal of relevantSignals) {
    const confidence = computeConfidence(signal, now)

    // Skip fully decayed signals (zero confidence)
    if (confidence === 0.0) {
      continue
    }

    const existing = valueGroups.get(signal.value)
    if (existing) {
      existing.totalScore += confidence
      existing.userIds.add(signal.userId)
      existing.count += 1
    } else {
      valueGroups.set(signal.value, {
        totalScore: confidence,
        userIds: new Set([signal.userId]),
        count: 1,
      })
    }
  }

  // If all signals have decayed, return null consensus
  if (valueGroups.size === 0) {
    return {
      consensusValue: null,
      confidenceScore: 0.0,
      reportCount: 0,
      lastUpdatedAt: now.toISOString(),
    }
  }

  // Find the value with the highest aggregate score
  let winningValue: string | null = null
  let highestScore = 0.0
  let winningUserIds: Set<string> = new Set()
  let winningCount = 0

  for (const [value, group] of valueGroups) {
    if (group.totalScore > highestScore) {
      highestScore = group.totalScore
      winningValue = value
      winningUserIds = group.userIds
      winningCount = group.count
    }
  }

  // Apply single-user confidence cap:
  // If all contributing signals come from one user, cap below 0.7
  if (winningUserIds.size === 1 && highestScore >= SINGLE_USER_CAP) {
    highestScore = SINGLE_USER_CAP - 0.01 // Cap at 0.69
  }

  // Apply consensus threshold: if below 0.15, return null
  if (highestScore < CONSENSUS_THRESHOLD) {
    return {
      consensusValue: null,
      confidenceScore: highestScore,
      reportCount: winningCount,
      lastUpdatedAt: now.toISOString(),
    }
  }

  // Clamp final score to [0, 1]
  const finalScore = Math.min(1.0, highestScore)

  return {
    consensusValue: winningValue,
    confidenceScore: finalScore,
    reportCount: winningCount,
    lastUpdatedAt: now.toISOString(),
  }
}
