//
// Backfill `totalCheckIns` on every node row (proof-of-demand R15.1, task 14.2).
//
// The business live panel reads a venue's lifetime check-in total from a counter
// maintained on the node row, incremented by the check-in service. Nodes that
// existed before that counter shipped carry no attribute, which reads as zero.
// This script derives the real total once, per venue, from the check-ins table
// and writes it, so the owner's "all time" number is right from the first panel
// load after deploy.
//
// Idempotent by construction: it SETs the derived count rather than adding to
// it, so a re-run converges on the same number. Run it once per environment,
// after the check-in counter is deployed (so no increment is lost between the
// count and the write).
//
// It lives in backend/src/scripts (with the other ops scripts) because that is
// where bare `@aws-sdk/*` specifiers resolve: the SDK is a backend dependency,
// so Node finds it in backend/node_modules and nowhere above it.
//
// Usage (from the repo root, with AWS credentials for the target account). The
// region must match the account holding the tables (prod is us-east-1):
//   NODES_TABLE=area-code-prod-nodes CHECKINS_TABLE=area-code-prod-checkins \
//     AWS_REGION=us-east-1 pnpm --filter backend backfill:node-checkin-totals
//
//   Add --dry-run to print what would change and write nothing:
//     ... pnpm --filter backend backfill:node-checkin-totals -- --dry-run

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const DRY_RUN = process.argv.includes('--dry-run')

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`[backfill] ${name} is not set. Required table env vars: NODES_TABLE, CHECKINS_TABLE, AWS_REGION.`)
    process.exit(1)
  }
  return value
}

const REGION = requireEnv('AWS_REGION')
const NODES_TABLE = requireEnv('NODES_TABLE')
const CHECKINS_TABLE = requireEnv('CHECKINS_TABLE')

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

/** Every node id, with whatever total it currently carries. */
async function listNodes() {
  const nodes = []
  let lastKey
  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: NODES_TABLE,
        ProjectionExpression: 'nodeId, totalCheckIns',
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    for (const item of page.Items ?? []) nodes.push(item)
    lastKey = page.LastEvaluatedKey
  } while (lastKey)
  return nodes
}

/**
 * The venue's real lifetime check-in count, paginated to completion and counted
 * server-side so no row history is pulled over the wire.
 */
async function countCheckIns(nodeId) {
  let total = 0
  let lastKey
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: CHECKINS_TABLE,
        IndexName: 'NodeIndex',
        KeyConditionExpression: 'nodeId = :nodeId',
        ExpressionAttributeValues: { ':nodeId': nodeId },
        Select: 'COUNT',
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    total += page.Count ?? 0
    lastKey = page.LastEvaluatedKey
  } while (lastKey)
  return total
}

async function main() {
  const nodes = await listNodes()
  console.log(`[backfill] ${nodes.length} node rows in ${NODES_TABLE}${DRY_RUN ? ' (dry run)' : ''}`)

  let written = 0
  let unchanged = 0

  for (const node of nodes) {
    const nodeId = node.nodeId
    const current = typeof node.totalCheckIns === 'number' ? node.totalCheckIns : null
    const derived = await countCheckIns(nodeId)

    if (current === derived) {
      unchanged++
      continue
    }

    console.log(`[backfill] ${nodeId}: ${current ?? 'absent'} -> ${derived}`)
    if (!DRY_RUN) {
      await documentClient.send(
        new UpdateCommand({
          TableName: NODES_TABLE,
          Key: { nodeId },
          UpdateExpression: 'SET totalCheckIns = :total',
          ExpressionAttributeValues: { ':total': derived },
        }),
      )
    }
    written++
  }

  console.log(`[backfill] done. ${written} ${DRY_RUN ? 'would be updated' : 'updated'}, ${unchanged} already correct.`)
}

main().catch((err) => {
  console.error('[backfill] failed:', err)
  process.exit(1)
})
