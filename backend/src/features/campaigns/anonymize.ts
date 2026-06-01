import { createHash, randomBytes } from 'node:crypto'

// ============================================================================
// Campaign Recipient Anonymization
// ============================================================================
//
// Campaign send records and analytics are keyed by a one-way, per-campaign
// hash of the recipient's userId — never the raw userId, email, or any phone
// number (Constraint C1, no SMS / no phone). The userId is used only
// transiently in dispatcher/sender memory; only the token below is persisted.
// ============================================================================

/**
 * Generate a per-campaign anonymization salt.
 *
 * The salt is not a secret — it exists to rotate the token space per campaign
 * so that the same userId produces a different token in each campaign, and so
 * tokens cannot be correlated across campaigns. It is stored on the campaign
 * document and used when deriving recipient tokens.
 */
export function generateCampaignSalt(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Derive a one-way recipient token: SHA-256(userId + campaignId + campaignSalt).
 *
 * This lets us record per-recipient send outcomes and compute attribution
 * (by re-deriving tokens from post-send check-ins) without ever persisting the
 * userId in a campaign or send-record document. The userId is not retained.
 */
export function recipientToken(userId: string, campaignId: string, campaignSalt: string): string {
  return createHash('sha256').update(`${userId}${campaignId}${campaignSalt}`).digest('hex')
}
