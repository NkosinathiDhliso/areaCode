// ============================================================================
// Signal Service — Orchestration Layer
// ============================================================================
//
// Coordinates signal submission, correction, contradiction detection,
// reputation, penalty, and dispute flows. Delegates to repository, aggregator,
// rate-limits, and proximity modules.

import { GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { AppError } from '../../shared/errors/AppError.js'

import type { SubmitSignalInput, SubmitSignalResult, SignalRecord, ConsensusResult } from './types.js'
import { storeSignal, getSignalsForNode, storeDispute, updateSignalConfidence } from './repository.js'
import { computeConsensus } from './aggregator.js'
import { classifyProximity } from './proximity.js'
import {
  checkRateLimit,
  checkDailyCap,
  checkOwnerRateLimit,
  recordSignalSubmission,
  recordOwnerSignalSubmission,
  checkDisputeLimit,
  recordDisputeSubmission,
} from './rate-limits.js'
import { kvIncr } from '../../shared/kv/dynamodb-kv.js'

// ============================================================================
// Constants
// ============================================================================

/** Signals within the last 24 hours are considered for consensus */
const SIGNAL_WINDOW_MS = 24 * 60 * 60 * 1000

/** Penalty reduction per upheld dispute (V1) */
const PENALTY_REDUCTION = 0.2

/** Minimum reporter weight in V1 (soft-ban floor) */
const MIN_REPORTER_WEIGHT = 0.1

/** Number of agreeing different-user reports to flag a contradiction */
const CONTRADICTION_THRESHOLD = 3

/** Dispute confidence multiplier (50% reduction) */
const DISPUTE_CONFIDENCE_MULTIPLIER = 0.5

/** Contradiction counter TTL: 7 days in seconds */
const CONTRADICTION_WINDOW_TTL_SECONDS = 7 * 24 * 60 * 60

/** Number of contradictions in 7 days that triggers a penalty */
const CONTRADICTION_PENALTY_THRESHOLD = 10

// ============================================================================
// submitSignal
// ============================================================================

/**
 * Orchestrates a new signal submission:
 * 1. Check rate limit (or detect correction window)
 * 2. Check daily cap
 * 3. Classify proximity
 * 4. Generate signalId and store signal
 * 5. Query recent signals and compute consensus
 * 6. Update node record with consensus fields
 * 7. Increment user reputation
 * 8. Record submission (sets rate limit + correction window + daily count)
 */
export async function submitSignal(input: SubmitSignalInput): Promise<SubmitSignalResult> {
  const { userId, nodeId, type, value, lat, lng, isOwner } = input

  // 1. Check rate limit (or correction window)
  const rateLimitResult = await checkRateLimit(userId, nodeId, type)

  if (!rateLimitResult.allowed) {
    throw AppError.tooManyRequests('Wait 5 minutes between reports')
  }

  // If this is a correction, delegate to correctSignal
  if (rateLimitResult.isCorrection) {
    return correctSignal(input)
  }

  // 2. Check daily cap
  const dailyCapResult = await checkDailyCap(userId)
  if (!dailyCapResult.allowed) {
    throw AppError.tooManyRequests('Daily signal limit reached')
  }

  // Owner-specific rate limit (30 min per type per node)
  if (isOwner) {
    const ownerResult = await checkOwnerRateLimit(userId, nodeId, type)
    if (!ownerResult.allowed) {
      throw AppError.tooManyRequests('Wait 30 minutes between owner reports')
    }
  }

  // 3. Classify proximity — get node coordinates from DynamoDB
  const nodeRecord = await documentClient.send(
    new GetCommand({
      TableName: TableNames.nodes,
      Key: { nodeId },
      ProjectionExpression: 'nodeId, lat, lng, businessId',
    }),
  )

  if (!nodeRecord.Item) {
    throw AppError.notFound('Node not found')
  }

  const nodeLat = nodeRecord.Item['lat'] as number | undefined
  const nodeLng = nodeRecord.Item['lng'] as number | undefined

  let isProximity = false
  if (nodeLat !== undefined && nodeLng !== undefined) {
    const classification = classifyProximity(lat, lng, nodeLat, nodeLng)
    isProximity = classification === 'Proximity_Report'
  }

  // 4. Get reporter weight from user record
  const reporterWeight = await getReporterWeightForUser(userId)

  // 5. Generate signal ID and timestamp
  const signalId = generateId()
  const now = new Date()
  const createdAt = now.toISOString()
  const sortKey = `${createdAt}#${userId}`

  // 6. Store signal
  const signalRecord: SignalRecord & { lat?: number; lng?: number } = {
    signalId,
    nodeId,
    userId,
    type,
    value,
    reporterWeight,
    isProximity,
    isOwner,
    createdAt,
    lat,
    lng,
  }

  await storeSignal(signalRecord)

  // 7. Query recent signals and compute consensus
  const since = new Date(now.getTime() - SIGNAL_WINDOW_MS)
  const recentSignals = await getSignalsForNode(nodeId, type, since)
  const consensus = computeConsensus(recentSignals, type, now)

  // 8. Detect contradictions
  const contradiction = detectContradiction(
    { value, userId },
    recentSignals,
  )

  // If contradiction detected, increment the user's contradiction counter
  if (contradiction) {
    const contradictionKey = `signal-contradictions:${userId}`
    const count = await kvIncr(contradictionKey, CONTRADICTION_WINDOW_TTL_SECONDS)

    // If threshold reached (10 in 7 days), apply penalty
    if (count >= CONTRADICTION_PENALTY_THRESHOLD) {
      await applyPenalty(userId, reporterWeight)
    }
  }

  // 9. Update node record with consensus fields
  await updateNodeConsensus(nodeId, type, consensus, now)

  // 10. Increment user reputation
  const reputationEarned = calculateReputation(isProximity)
  await incrementUserReputation(userId, reputationEarned)

  // 11. Record submission (rate limit + correction window + daily count)
  await recordSignalSubmission(userId, nodeId, type, sortKey)

  // Record owner rate limit if applicable
  if (isOwner) {
    await recordOwnerSignalSubmission(userId, nodeId, type)
  }

  return {
    signalId,
    reputationEarned,
    isProximityReport: isProximity,
  }
}

// ============================================================================
// correctSignal
// ============================================================================

/**
 * Handles a correction within the 2-minute window:
 * - Deletes the previous signal for the same type/node/user
 * - Stores the new signal in its place
 * - Recomputes consensus
 * - No additional reputation is awarded for corrections
 */
export async function correctSignal(input: SubmitSignalInput): Promise<SubmitSignalResult> {
  const { userId, nodeId, type, value, lat, lng, isOwner } = input

  // Get the correction window sort key (reference to the signal to overwrite)
  const rateLimitResult = await checkRateLimit(userId, nodeId, type)

  if (!rateLimitResult.isCorrection || !rateLimitResult.correctionSortKey) {
    throw AppError.badRequest('No correction window available')
  }

  const previousSortKey = rateLimitResult.correctionSortKey

  // Delete the previous signal
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: {
        pk: `SIGNAL#${nodeId}`,
        sk: previousSortKey,
      },
    }),
  )

  // Classify proximity
  const nodeRecord = await documentClient.send(
    new GetCommand({
      TableName: TableNames.nodes,
      Key: { nodeId },
      ProjectionExpression: 'nodeId, lat, lng',
    }),
  )

  const nodeLat = nodeRecord.Item?.['lat'] as number | undefined
  const nodeLng = nodeRecord.Item?.['lng'] as number | undefined

  let isProximity = false
  if (nodeLat !== undefined && nodeLng !== undefined) {
    const classification = classifyProximity(lat, lng, nodeLat, nodeLng)
    isProximity = classification === 'Proximity_Report'
  }

  // Get reporter weight
  const reporterWeight = await getReporterWeightForUser(userId)

  // Store the corrected signal
  const signalId = generateId()
  const now = new Date()
  const createdAt = now.toISOString()
  const sortKey = `${createdAt}#${userId}`

  const signalRecord: SignalRecord & { lat?: number; lng?: number } = {
    signalId,
    nodeId,
    userId,
    type,
    value,
    reporterWeight,
    isProximity,
    isOwner,
    createdAt,
    lat,
    lng,
  }

  await storeSignal(signalRecord)

  // Recompute consensus
  const since = new Date(now.getTime() - SIGNAL_WINDOW_MS)
  const recentSignals = await getSignalsForNode(nodeId, type, since)
  const consensus = computeConsensus(recentSignals, type, now)

  // Update node record
  await updateNodeConsensus(nodeId, type, consensus, now)

  // Record the new correction window (overwrite the existing one)
  await recordSignalSubmission(userId, nodeId, type, sortKey)

  // No reputation awarded for corrections
  return {
    signalId,
    reputationEarned: 0,
    isProximityReport: isProximity,
  }
}

// ============================================================================
// calculateReputation
// ============================================================================

/**
 * Calculates reputation points earned for a signal submission.
 * - Proximity_Report: 2 points
 * - Remote_Report: 1 point
 */
export function calculateReputation(isProximity: boolean): number {
  return isProximity ? 2 : 1
}

// ============================================================================
// detectContradiction
// ============================================================================

/**
 * Detects whether a new signal contradicts the existing consensus.
 *
 * A contradiction is flagged when 3+ different users agree on a different
 * value for the same node and type.
 *
 * @returns true if the new signal contradicts the majority
 */
export function detectContradiction(
  newSignal: { value: string; userId: string },
  existingSignals: SignalRecord[],
): boolean {
  // Group existing signals by value, counting unique users per value
  const valueUserCounts = new Map<string, Set<string>>()

  for (const signal of existingSignals) {
    // Skip signals from the same user as the new signal
    if (signal.userId === newSignal.userId) continue

    const existing = valueUserCounts.get(signal.value)
    if (existing) {
      existing.add(signal.userId)
    } else {
      valueUserCounts.set(signal.value, new Set([signal.userId]))
    }
  }

  // Check if any value different from the new signal has 3+ unique users
  for (const [value, userIds] of valueUserCounts) {
    if (value !== newSignal.value && userIds.size >= CONTRADICTION_THRESHOLD) {
      return true
    }
  }

  return false
}

// ============================================================================
// applyPenalty
// ============================================================================

/**
 * Reduces a reporter's weight by 0.2, with a minimum floor of 0.1 (V1 soft-ban).
 * Phase 2 will reduce the floor to 0.0 (hard-ban).
 *
 * @param userId - The user to penalize
 * @param currentWeight - The user's current reporter weight
 * @returns The new reporter weight after penalty
 */
export async function applyPenalty(userId: string, currentWeight: number): Promise<number> {
  const newWeight = Math.max(MIN_REPORTER_WEIGHT, currentWeight - PENALTY_REDUCTION)

  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.users,
      Key: { userId },
      UpdateExpression: 'SET reporterWeight = :weight, reporterWeightUpdatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':weight': newWeight,
        ':updatedAt': new Date().toISOString(),
      },
    }),
  )

  return newWeight
}

// ============================================================================
// disputeSignal
// ============================================================================

/**
 * Files a dispute against a signal:
 * 1. Verify the business owns the node associated with the signal
 * 2. Check dispute daily limit (5/day)
 * 3. Store the dispute record
 * 4. Reduce the disputed signal's confidence by 50%
 * 5. Record the dispute submission
 *
 * The signalId parameter is the sort key of the signal record (timestamp#userId).
 * The handler resolves the signal and provides nodeId via the 4th parameter,
 * since signals are keyed by SIGNAL#<nodeId> in DynamoDB.
 */
export async function disputeSignal(
  signalId: string,
  businessId: string,
  reason: string,
  nodeId?: string,
): Promise<void> {
  if (!nodeId) {
    throw AppError.badRequest('nodeId is required to dispute a signal')
  }

  // 1. Verify business owns the node
  const nodeRecord = await documentClient.send(
    new GetCommand({
      TableName: TableNames.nodes,
      Key: { nodeId },
      ProjectionExpression: 'nodeId, businessId',
    }),
  )

  if (!nodeRecord.Item) {
    throw AppError.notFound('Node not found')
  }

  const nodeBusinessId = nodeRecord.Item['businessId'] as string | undefined
  if (nodeBusinessId !== businessId) {
    throw AppError.forbidden('You can only dispute signals on your own venue')
  }

  // 2. Check dispute daily limit
  const disputeLimitResult = await checkDisputeLimit(businessId)
  if (!disputeLimitResult.allowed) {
    throw AppError.tooManyRequests('Daily dispute limit reached')
  }

  // 3. Store the dispute record
  const now = new Date()
  const disputeId = generateId()

  await storeDispute({
    disputeId,
    nodeId,
    signalId,
    businessId,
    reason,
    status: 'pending',
    createdAt: now.toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  })

  // 4. Reduce the disputed signal's confidence by 50%
  await updateSignalConfidence(signalId, nodeId, DISPUTE_CONFIDENCE_MULTIPLIER)

  // 5. Record the dispute submission (daily counter)
  await recordDisputeSubmission(businessId)
}

// ============================================================================
// getActiveSignals
// ============================================================================

/**
 * Retrieves the current consensus for a node by querying recent signals
 * and computing consensus for both signal types.
 */
export async function getActiveSignals(nodeId: string): Promise<{
  genre: ConsensusResult
  queue: ConsensusResult
}> {
  const now = new Date()
  const since = new Date(now.getTime() - SIGNAL_WINDOW_MS)

  // Query all recent signals for the node (both types)
  const [genreSignals, queueSignals] = await Promise.all([
    getSignalsForNode(nodeId, 'genre_playing', since),
    getSignalsForNode(nodeId, 'queue_length', since),
  ])

  const genreConsensus = computeConsensus(genreSignals, 'genre_playing', now)
  const queueConsensus = computeConsensus(queueSignals, 'queue_length', now)

  return {
    genre: genreConsensus,
    queue: queueConsensus,
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Gets the reporter weight for a user from the users DynamoDB table.
 * Falls back to 1.0 (local tier default) if not set.
 */
async function getReporterWeightForUser(userId: string): Promise<number> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.users,
      Key: { userId },
      ProjectionExpression: 'reporterWeight, tier',
    }),
  )

  if (!result.Item) {
    return 1.0 // Default to local tier weight
  }

  // If reporterWeight is explicitly set, use it
  const weight = result.Item['reporterWeight'] as number | undefined
  if (weight !== undefined) {
    return weight
  }

  // Otherwise derive from tier (fallback for users who haven't had weight set)
  return 1.0
}

/**
 * Updates the node record in DynamoDB with the latest consensus fields.
 * Uses UpdateItem to set consensus fields without overwriting other node data.
 */
async function updateNodeConsensus(
  nodeId: string,
  type: 'genre_playing' | 'queue_length',
  consensus: ConsensusResult,
  now: Date,
): Promise<void> {
  const updateExprParts: string[] = []
  const exprAttrValues: Record<string, unknown> = {}
  const exprAttrNames: Record<string, string> = {}

  if (type === 'genre_playing') {
    updateExprParts.push('#cg = :consensusGenre')
    updateExprParts.push('#cgc = :consensusGenreConfidence')
    exprAttrNames['#cg'] = 'consensusGenre'
    exprAttrNames['#cgc'] = 'consensusGenreConfidence'
    exprAttrValues[':consensusGenre'] = consensus.consensusValue
    exprAttrValues[':consensusGenreConfidence'] = consensus.confidenceScore
  } else {
    updateExprParts.push('#cq = :consensusQueue')
    updateExprParts.push('#cqc = :consensusQueueConfidence')
    exprAttrNames['#cq'] = 'consensusQueue'
    exprAttrNames['#cqc'] = 'consensusQueueConfidence'
    exprAttrValues[':consensusQueue'] = consensus.consensusValue
    exprAttrValues[':consensusQueueConfidence'] = consensus.confidenceScore
  }

  // Always update shared fields
  updateExprParts.push('#src = :reportCount')
  updateExprParts.push('#lsa = :lastSignalAt')
  updateExprParts.push('#sua = :signalUpdatedAt')

  exprAttrNames['#src'] = 'signalReportCount'
  exprAttrNames['#lsa'] = 'lastSignalAt'
  exprAttrNames['#sua'] = 'signalUpdatedAt'

  exprAttrValues[':reportCount'] = consensus.reportCount
  exprAttrValues[':lastSignalAt'] = now.toISOString()
  exprAttrValues[':signalUpdatedAt'] = now.toISOString()

  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.nodes,
      Key: { nodeId },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    }),
  )
}

/**
 * Atomically increments the user's reputation in the users DynamoDB table.
 * Uses ADD operation for atomic increment (safe under concurrent submissions).
 */
async function incrementUserReputation(userId: string, points: number): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.users,
      Key: { userId },
      UpdateExpression: 'ADD reputation :points',
      ExpressionAttributeValues: {
        ':points': points,
      },
    }),
  )
}
