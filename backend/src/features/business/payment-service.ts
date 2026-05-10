/**
 * Payment Service — processes Yoco payment events and stores payment records
 * with the dual-key pattern for both per-business billing and per-month revenue aggregation.
 *
 * Dual-key pattern:
 * - pk=PAYMENT#<businessId>, sk=<timestamp>#<paymentId> → per-business billing queries
 * - gsi1pk=REVENUE#<YYYY-MM> (SAST timezone), gsi1sk=<timestamp>#<paymentId> → admin revenue aggregation
 *
 * Idempotency: Uses ConditionExpression 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
 */

import { createPaymentRecord, type CreatePaymentRecordInput } from './repository.js'

export interface YocoPaymentEvent {
  id: string
  amount: number
  createdDate: string
  metadata: {
    businessId: string
    type: 'subscription' | 'boost'
    plan?: string
    nodeId?: string
    duration?: string
  }
}

export interface ProcessPaymentResult {
  duplicate: boolean
}

/**
 * Process a Yoco payment event — store payment record with dual-key pattern.
 *
 * Fields stored:
 * - amount: ZAR cents (integer)
 * - type: 'subscription' | 'boost'
 * - planTier: business plan tier
 * - businessId: owning business UUID
 * - nodeId: node UUID (for boosts, null for subscriptions)
 * - status: 'succeeded' | 'failed' | 'refunded' | 'pending'
 * - paymentProvider: 'yoco'
 * - currency: 'ZAR'
 *
 * Uses ConditionExpression for idempotency — duplicate paymentId writes return { duplicate: true }.
 */
export async function processPaymentEvent(
  event: YocoPaymentEvent,
  status: 'succeeded' | 'failed' | 'refunded' | 'pending' = 'succeeded',
): Promise<ProcessPaymentResult> {
  const { id: paymentId, amount, createdDate, metadata } = event
  const { businessId, type, plan, nodeId } = metadata

  const input: CreatePaymentRecordInput = {
    paymentId,
    businessId,
    amount,
    type,
    planTier: plan ?? 'starter',
    nodeId: nodeId ?? null,
    status,
    description: type === 'boost'
      ? `Boost (${metadata.duration ?? ''})`
      : `${plan ?? 'starter'} subscription`,
    createdAt: createdDate,
  }

  return createPaymentRecord(input)
}

/**
 * Compute the SAST (Africa/Johannesburg, UTC+2) YYYY-MM partition key for a given ISO timestamp.
 * Exported for testing purposes.
 */
export function getRevenuePartitionMonth(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  // Convert to SAST (UTC+2)
  const sastOffset = 2 * 60 * 60 * 1000
  const sastDate = new Date(date.getTime() + sastOffset)
  const year = sastDate.getUTCFullYear()
  const month = String(sastDate.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}
