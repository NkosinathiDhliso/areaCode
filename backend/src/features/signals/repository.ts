import { PutCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import type { SignalRecord, DisputeRecord } from './types.js'

// ============================================================================
// Constants
// ============================================================================

/** Signal TTL: 24 hours in seconds */
const SIGNAL_TTL_SECONDS = 24 * 60 * 60

/** Dispute TTL: 30 days in seconds */
const DISPUTE_TTL_SECONDS = 30 * 24 * 60 * 60

// ============================================================================
// Signal Operations
// ============================================================================

/**
 * Stores a signal in the app-data DynamoDB table.
 *
 * Key schema:
 *   pk: SIGNAL#<nodeId>
 *   sk: <ISO timestamp>#<userId>
 *   ttl: createdAt + 24 hours (epoch seconds)
 */
export async function storeSignal(signal: SignalRecord & {
  lat?: number
  lng?: number
  disputeMultiplier?: number
}): Promise<void> {
  const createdAtEpoch = Math.floor(new Date(signal.createdAt).getTime() / 1000)
  const ttl = createdAtEpoch + SIGNAL_TTL_SECONDS

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `SIGNAL#${signal.nodeId}`,
        sk: `${signal.createdAt}#${signal.userId}`,
        type: signal.type,
        value: signal.value,
        userId: signal.userId,
        nodeId: signal.nodeId,
        signalId: signal.signalId,
        reporterWeight: signal.reporterWeight,
        isProximity: signal.isProximity,
        isOwner: signal.isOwner,
        lat: signal.lat,
        lng: signal.lng,
        disputeMultiplier: signal.disputeMultiplier ?? 1.0,
        createdAt: signal.createdAt,
        ttl,
      },
    }),
  )
}

/**
 * Queries signals for a given node, filtered by type and since timestamp.
 *
 * Returns signals in reverse chronological order (newest first).
 */
export async function getSignalsForNode(
  nodeId: string,
  type: string,
  since: Date,
): Promise<SignalRecord[]> {
  const sinceIso = since.toISOString()

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND sk >= :since',
      FilterExpression: '#type = :type',
      ExpressionAttributeNames: {
        '#type': 'type',
      },
      ExpressionAttributeValues: {
        ':pk': `SIGNAL#${nodeId}`,
        ':since': sinceIso,
        ':type': type,
      },
      ScanIndexForward: false,
    }),
  )

  return (result.Items || []).map((item) => ({
    signalId: item['signalId'] as string,
    nodeId: item['nodeId'] as string,
    userId: item['userId'] as string,
    type: item['type'] as SignalRecord['type'],
    value: item['value'] as string,
    reporterWeight: item['reporterWeight'] as number,
    isProximity: item['isProximity'] as boolean,
    isOwner: item['isOwner'] as boolean,
    createdAt: item['createdAt'] as string,
  }))
}

// ============================================================================
// Dispute Operations
// ============================================================================

/**
 * Stores a dispute in the app-data DynamoDB table.
 *
 * Key schema:
 *   pk: DISPUTE#<nodeId>
 *   sk: <ISO timestamp>#<businessId>
 *   ttl: createdAt + 30 days (epoch seconds)
 */
export async function storeDispute(dispute: DisputeRecord): Promise<void> {
  const createdAtEpoch = Math.floor(new Date(dispute.createdAt).getTime() / 1000)
  const ttl = createdAtEpoch + DISPUTE_TTL_SECONDS

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `DISPUTE#${dispute.nodeId}`,
        sk: `${dispute.createdAt}#${dispute.businessId}`,
        gsi1pk: `DISPUTES#${dispute.businessId}`,
        gsi1sk: dispute.createdAt,
        disputeId: dispute.disputeId,
        nodeId: dispute.nodeId,
        signalId: dispute.signalId,
        businessId: dispute.businessId,
        reason: dispute.reason,
        status: dispute.status,
        createdAt: dispute.createdAt,
        resolvedAt: dispute.resolvedAt,
        resolvedBy: dispute.resolvedBy,
        ttl,
      },
    }),
  )
}

/**
 * Queries disputes for a given business since a timestamp.
 *
 * Uses a filter on businessId since disputes are partitioned by nodeId.
 * For admin queue queries (all pending disputes), use a GSI query instead.
 */
export async function getDisputesForBusiness(
  businessId: string,
  since: Date,
): Promise<DisputeRecord[]> {
  const sinceIso = since.toISOString()

  // Disputes are keyed by nodeId, so we query using GSI1 if available,
  // or scan with filter. For V1, we use a query on the businessId filter.
  // Since disputes are partitioned by DISPUTE#<nodeId>, we need to scan
  // with a filter expression for businessId-based lookups.
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :gsi1pk AND gsi1sk >= :since',
      ExpressionAttributeValues: {
        ':gsi1pk': `DISPUTES#${businessId}`,
        ':since': sinceIso,
      },
      ScanIndexForward: false,
    }),
  )

  return (result.Items || []).map((item) => ({
    disputeId: item['disputeId'] as string,
    nodeId: item['nodeId'] as string,
    signalId: item['signalId'] as string,
    businessId: item['businessId'] as string,
    reason: item['reason'] as string,
    status: item['status'] as DisputeRecord['status'],
    createdAt: item['createdAt'] as string,
    resolvedAt: (item['resolvedAt'] as string) ?? null,
    resolvedBy: (item['resolvedBy'] as string) ?? null,
  }))
}

// ============================================================================
// Signal Update Operations
// ============================================================================

/**
 * Updates the disputeMultiplier on a signal record.
 *
 * Used when a dispute is filed (multiplier = 0.5) or dismissed (multiplier = 1.0).
 */
export async function updateSignalConfidence(
  signalId: string,
  nodeId: string,
  multiplier: number,
): Promise<void> {
  // signalId is the sort key: <timestamp>#<userId>
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: {
        pk: `SIGNAL#${nodeId}`,
        sk: signalId,
      },
      UpdateExpression: 'SET disputeMultiplier = :multiplier',
      ExpressionAttributeValues: {
        ':multiplier': multiplier,
      },
    }),
  )
}
