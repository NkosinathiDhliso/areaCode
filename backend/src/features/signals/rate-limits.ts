import { kvGet, kvSet, kvIncr } from '../../shared/kv/dynamodb-kv.js'
import type { SignalType } from './types.js'

// ============================================================================
// Constants
// ============================================================================

/** 5-minute rate limit per type/node/user (V1) */
const RATE_LIMIT_TTL_SECONDS = 300

/** 2-minute correction window after submission */
const CORRECTION_WINDOW_TTL_SECONDS = 120

/** Daily signal cap per user (V1: 50 signals/day) */
const DAILY_SIGNAL_CAP = 50

/** Daily cap TTL: 24 hours + 1 hour buffer */
const DAILY_CAP_TTL_SECONDS = 86400 + 3600

/** Owner rate limit: 30 minutes per type per node */
const OWNER_RATE_LIMIT_TTL_SECONDS = 1800

/** Dispute daily limit per business */
const DISPUTE_DAILY_LIMIT = 5

/** Dispute daily limit TTL: 24 hours + 1 hour buffer */
const DISPUTE_DAILY_TTL_SECONDS = 86400 + 3600

// ============================================================================
// Key Builders
// ============================================================================

function rateLimitKey(userId: string, nodeId: string, type: SignalType): string {
  return `signal-rate:${userId}:${nodeId}:${type}`
}

function correctionWindowKey(userId: string, nodeId: string, type: SignalType): string {
  return `signal-correction:${userId}:${nodeId}:${type}`
}

function dailyCapKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return `signal-daily:${userId}:${today}`
}

function ownerRateLimitKey(userId: string, nodeId: string, type: SignalType): string {
  return `signal-owner-rate:${userId}:${nodeId}:${type}`
}

function disputeDailyKey(businessId: string): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return `signal-dispute-daily:${businessId}:${today}`
}

// ============================================================================
// Rate Limit Checks
// ============================================================================

export interface RateLimitResult {
  allowed: boolean
  isCorrection: boolean
  correctionSortKey?: string
}

/**
 * Checks whether a user can submit a signal for a given type/node.
 *
 * Logic:
 * 1. If a correction window exists (within 2 minutes of last submission),
 *    the submission is allowed as a correction (overwrite).
 * 2. If a rate limit key exists (within 5 minutes), the submission is blocked.
 * 3. Otherwise, the submission is allowed as a new signal.
 */
export async function checkRateLimit(
  userId: string,
  nodeId: string,
  type: SignalType
): Promise<RateLimitResult> {
  // Check correction window first — allows overwrite within 2 minutes
  const correctionKey = correctionWindowKey(userId, nodeId, type)
  const correctionValue = await kvGet(correctionKey)

  if (correctionValue) {
    return {
      allowed: true,
      isCorrection: true,
      correctionSortKey: correctionValue,
    }
  }

  // Check rate limit — blocks if within 5-minute window
  const rateKey = rateLimitKey(userId, nodeId, type)
  const rateValue = await kvGet(rateKey)

  if (rateValue) {
    return {
      allowed: false,
      isCorrection: false,
    }
  }

  // No rate limit or correction window — new signal allowed
  return {
    allowed: true,
    isCorrection: false,
  }
}

// ============================================================================
// Daily Cap Check
// ============================================================================

export interface DailyCapResult {
  allowed: boolean
  count: number
}

/**
 * Checks whether a user has reached their daily signal cap (50/day in V1).
 *
 * Returns the current count and whether the user is allowed to submit.
 * The count is read without incrementing — use recordSignalSubmission to increment.
 */
export async function checkDailyCap(userId: string): Promise<DailyCapResult> {
  const key = dailyCapKey(userId)
  const value = await kvGet(key)
  const count = value ? parseInt(value, 10) : 0

  return {
    allowed: count < DAILY_SIGNAL_CAP,
    count,
  }
}

// ============================================================================
// Owner Rate Limit Check
// ============================================================================

export interface OwnerRateLimitResult {
  allowed: boolean
}

/**
 * Checks whether a business owner can submit a signal for a given type/node.
 * Owners are limited to 1 signal per type per node per 30 minutes.
 */
export async function checkOwnerRateLimit(
  userId: string,
  nodeId: string,
  type: SignalType
): Promise<OwnerRateLimitResult> {
  const key = ownerRateLimitKey(userId, nodeId, type)
  const value = await kvGet(key)

  return {
    allowed: !value,
  }
}

// ============================================================================
// Dispute Limit Check
// ============================================================================

export interface DisputeLimitResult {
  allowed: boolean
}

/**
 * Checks whether a business has reached their daily dispute limit (5/day).
 */
export async function checkDisputeLimit(businessId: string): Promise<DisputeLimitResult> {
  const key = disputeDailyKey(businessId)
  const value = await kvGet(key)
  const count = value ? parseInt(value, 10) : 0

  return {
    allowed: count < DISPUTE_DAILY_LIMIT,
  }
}

// ============================================================================
// Recording Submissions
// ============================================================================

/**
 * Records a signal submission by setting:
 * 1. Rate limit key (5-minute TTL) — prevents duplicate submissions
 * 2. Correction window key (2-minute TTL) — stores the signal sort key for overwrite
 * 3. Daily cap increment — tracks total signals submitted today
 *
 * Call this AFTER successfully storing the signal.
 */
export async function recordSignalSubmission(
  userId: string,
  nodeId: string,
  type: SignalType,
  signalSortKey: string
): Promise<void> {
  const rateKey = rateLimitKey(userId, nodeId, type)
  const correctionKey = correctionWindowKey(userId, nodeId, type)
  const dailyKey = dailyCapKey(userId)

  await Promise.all([
    // Set 5-minute rate limit
    kvSet(rateKey, '1', RATE_LIMIT_TTL_SECONDS),
    // Set 2-minute correction window with the signal sort key
    kvSet(correctionKey, signalSortKey, CORRECTION_WINDOW_TTL_SECONDS),
    // Increment daily signal count
    kvIncr(dailyKey, DAILY_CAP_TTL_SECONDS),
  ])
}

/**
 * Records an owner signal submission by setting the 30-minute rate limit.
 * Call this AFTER successfully storing the owner signal.
 */
export async function recordOwnerSignalSubmission(
  userId: string,
  nodeId: string,
  type: SignalType
): Promise<void> {
  const key = ownerRateLimitKey(userId, nodeId, type)
  await kvSet(key, '1', OWNER_RATE_LIMIT_TTL_SECONDS)
}

/**
 * Records a dispute submission by incrementing the daily dispute counter.
 * Call this AFTER successfully storing the dispute.
 */
export async function recordDisputeSubmission(businessId: string): Promise<void> {
  const key = disputeDailyKey(businessId)
  await kvIncr(key, DISPUTE_DAILY_TTL_SECONDS)
}
