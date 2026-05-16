/**
 * Casual-Customer First-Get path — Churn-defences spec, Requirement 6.
 *
 * Lets a first-time walk-in claim one introductory reward without any
 * personal information at the till. The staff confirms the redemption,
 * the system mints a one-time claim token (8 chars, base32). The
 * customer takes that token home (printed receipt, screen photo, hand-
 * scribbled, doesn't matter), signs up at their leisure, and the token
 * is exchanged for one historical visit credit on first login.
 *
 * Token model rather than phone-based because:
 *   1. SMS auth is permanently disabled in this stack — no phone OTP
 *      means no phone we can verify.
 *   2. Tokens carry no PII whatsoever, so retention rules are simple
 *      and POPIA stays clean.
 *   3. The customer chooses their own email / Google identity at signup
 *      and inherits the credit. No identity is collected at the till.
 *
 * Storage:
 *   pk = GUESTTOKEN#<token>
 *   sk = TOKEN
 *   ttl = epoch (issuedAt + 60 days)
 */

import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

export interface GuestClaim {
  token: string
  rewardId: string
  nodeId: string
  staffId: string
  staffName?: string
  issuedAt: string
  conversionExpiresAt: string
  redeemedByUserId?: string
  redeemedAt?: string
}

const CONVERSION_WINDOW_DAYS = 30
const RETENTION_AFTER_WINDOW_DAYS = 30 // POPIA grace; total 60 days max

// Base32 (Crockford) alphabet — no I, L, O, U to avoid OCR confusion on receipts.
const TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TOKEN_LENGTH = 8

export class GuestClaimAbuseError extends Error {
  code: 'token_already_used' | 'token_not_found' | 'token_expired'
  constructor(code: 'token_already_used' | 'token_not_found' | 'token_expired') {
    super(code)
    this.code = code
    this.name = 'GuestClaimAbuseError'
  }
}

function pk(token: string): string {
  return `GUESTTOKEN#${token}`
}

function generateToken(): string {
  // Web-Crypto-backed in Lambda; cryptographically random.
  const buf = new Uint8Array(TOKEN_LENGTH)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += TOKEN_ALPHABET[buf[i]! % TOKEN_ALPHABET.length]
  }
  return out
}

export async function getClaim(token: string): Promise<GuestClaim | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: pk(token), sk: 'TOKEN' },
    }),
  )
  if (!result.Item) return null
  const item = result.Item
  return {
    token: item['token'] as string,
    rewardId: item['rewardId'] as string,
    nodeId: item['nodeId'] as string,
    staffId: item['staffId'] as string,
    staffName: item['staffName'] as string | undefined,
    issuedAt: item['issuedAt'] as string,
    conversionExpiresAt: item['conversionExpiresAt'] as string,
    redeemedByUserId: item['redeemedByUserId'] as string | undefined,
    redeemedAt: item['redeemedAt'] as string | undefined,
  }
}

interface CreateInput {
  rewardId: string
  nodeId: string
  staffId: string
  staffName?: string
  now?: Date
}

export async function createGuestClaim({
  rewardId,
  nodeId,
  staffId,
  staffName,
  now = new Date(),
}: CreateInput): Promise<GuestClaim> {
  // Token uniqueness: collisions at 32^8 ≈ 1.1e12 are vanishingly rare,
  // but cheap to retry. One round of paranoia and we're done.
  let token = generateToken()
  if (await getClaim(token)) token = generateToken()

  const issuedAt = now.toISOString()
  const conversionExpiresAt = new Date(now.getTime() + CONVERSION_WINDOW_DAYS * 86_400_000).toISOString()
  const ttl = Math.floor(now.getTime() / 1000) + (CONVERSION_WINDOW_DAYS + RETENTION_AFTER_WINDOW_DAYS) * 86_400

  const claim: GuestClaim = {
    token,
    rewardId,
    nodeId,
    staffId,
    ...(staffName ? { staffName } : {}),
    issuedAt,
    conversionExpiresAt,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: { pk: pk(token), sk: 'TOKEN', ...claim, ttl },
    }),
  )

  return claim
}

/**
 * Atomically claim the token for a newly signed-up user. Returns the
 * claim record if successful, throws otherwise.
 */
export async function redeemTokenForUser(token: string, userId: string, now: Date = new Date()): Promise<GuestClaim> {
  const claim = await getClaim(token)
  if (!claim) throw new GuestClaimAbuseError('token_not_found')
  if (claim.redeemedAt) throw new GuestClaimAbuseError('token_already_used')
  if (Date.parse(claim.conversionExpiresAt) < now.getTime()) {
    throw new GuestClaimAbuseError('token_expired')
  }

  const redeemedAt = now.toISOString()
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: pk(token),
        sk: 'TOKEN',
        ...claim,
        redeemedByUserId: userId,
        redeemedAt,
        ttl: Math.floor(now.getTime() / 1000) + RETENTION_AFTER_WINDOW_DAYS * 86_400,
      },
      // Guard against double-redeem races: only persist if redeemedAt is unset.
      ConditionExpression: 'attribute_not_exists(redeemedAt)',
    }),
  )

  return { ...claim, redeemedByUserId: userId, redeemedAt }
}

export async function deleteClaim(token: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: pk(token), sk: 'TOKEN' },
    }),
  )
}

/**
 * Lightweight scan used by the leaderboard to count guest claims by staff
 * member within a time window. Bounded by GUESTTOKEN# prefix.
 */
export interface GuestClaimSummaryRow {
  staffId: string
  staffName?: string
  nodeId: string
  issuedAt: string
  redeemedAt?: string
  redeemedByUserId?: string
}

export async function listGuestClaimsSince(
  sinceIso: string,
  prefix: 'issuedAt' | 'redeemedAt' = 'issuedAt',
): Promise<GuestClaimSummaryRow[]> {
  const out: GuestClaimSummaryRow[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.appData,
        FilterExpression: `begins_with(pk, :prefix) AND ${prefix} >= :since`,
        ExpressionAttributeValues: { ':prefix': 'GUESTTOKEN#', ':since': sinceIso },
        ProjectionExpression: 'staffId, staffName, nodeId, issuedAt, redeemedAt, redeemedByUserId',
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      out.push({
        staffId: item['staffId'] as string,
        staffName: item['staffName'] as string | undefined,
        nodeId: item['nodeId'] as string,
        issuedAt: item['issuedAt'] as string,
        redeemedAt: item['redeemedAt'] as string | undefined,
        redeemedByUserId: item['redeemedByUserId'] as string | undefined,
      })
    }
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)
  return out
}
