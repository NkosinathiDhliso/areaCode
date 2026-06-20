#!/usr/bin/env node
/**
 * clear-stale-cognito-sub.mjs
 *
 * One-off migration for the Cognito consumer/business pool replacement.
 *
 * WHY: recreating a Cognito user pool (required to switch username_attributes
 * from phone_number to email) destroys every Cognito identity. The DynamoDB
 * user/business records survive, but their stored `cognitoSub` now points at a
 * dead identity. On next Google sign-in the user gets a brand-new sub;
 * `consumerOAuthSync` looks them up by email, sees a mismatched cognitoSub, and
 * throws "This email is already registered" — locking them out.
 *
 * This script clears the stale `cognitoSub` attribute so the re-link path in
 * consumerOAuthSync re-attaches the new identity to the existing record
 * (preserving check-ins / tier / rewards) instead of duplicating it.
 *
 * SAFETY:
 *   - Dry-run by default. Prints what it WOULD change and exits.
 *   - Pass --apply to actually write.
 *   - Only removes the `cognitoSub` attribute; touches nothing else.
 *   - Run AFTER the pool replacement has been applied.
 *
 * USAGE (PowerShell, run from the backend/ directory so the AWS SDK resolves):
 *   node scripts/clear-stale-cognito-sub.mjs --table area-code-prod-users
 *   node scripts/clear-stale-cognito-sub.mjs --table area-code-prod-users --apply
 *   node scripts/clear-stale-cognito-sub.mjs --table area-code-prod-businesses --key businessId --apply
 *
 * Requires AWS credentials in the environment (same ones the AWS CLI uses).
 */
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const TABLE = arg('--table')
const REGION = arg('--region', process.env.AWS_REGION || 'us-east-1')
const APPLY = process.argv.includes('--apply')
const KEY_ATTR = arg('--key', 'userId') // 'userId' for users table, 'businessId' for businesses

if (!TABLE) {
  console.error('ERROR: --table is required (e.g. --table area-code-prod-users)')
  process.exit(1)
}

const client = new DynamoDBClient({ region: REGION })

async function* scanAll() {
  let ExclusiveStartKey
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: TABLE,
        ProjectionExpression: '#k, cognitoSub, email, phone',
        ExpressionAttributeNames: { '#k': KEY_ATTR },
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }),
    )
    for (const item of res.Items ?? []) yield item
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
}

async function main() {
  console.log(`Table: ${TABLE}  Region: ${REGION}  Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  let scanned = 0
  let toClear = 0

  for await (const item of scanAll()) {
    scanned += 1
    if (!item.cognitoSub) continue
    toClear += 1
    const keyVal = item[KEY_ATTR]?.S
    const emailVal = item.email?.S ? '(email)' : item.phone?.S ? '(phone)' : '(no email/phone)'
    console.log(`  ${APPLY ? 'clearing' : 'would clear'} cognitoSub on ${KEY_ATTR}=${keyVal} ${emailVal}`)

    if (APPLY) {
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { [KEY_ATTR]: { S: keyVal } },
          UpdateExpression: 'REMOVE cognitoSub',
        }),
      )
    }
  }

  console.log(`\nScanned ${scanned} records. ${toClear} had a cognitoSub.`)
  if (!APPLY && toClear > 0) {
    console.log('Dry-run only. Re-run with --apply to write the changes.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
