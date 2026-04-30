/**
 * Partition manager , NO-OP for DynamoDB.
 * DynamoDB handles partitioning automatically. This worker is kept
 * as a stub so EventBridge config doesn't break.
 */
export async function handler() {
  console.log('[partition-manager] No-op , DynamoDB handles partitioning automatically')
  return { created: 0 }
}
