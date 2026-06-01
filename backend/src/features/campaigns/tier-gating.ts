import { AppError } from '../../shared/errors/AppError.js'

// ============================================================================
// Win-Back Campaigns — Tier Gating (Requirements 9.1, 9.2 / Property 13)
// ----------------------------------------------------------------------------
// Mirrors the reports feature's `tier-gating.ts` precedent: a tiny, pure module
// that decides entitlement from the business's EFFECTIVE tier string. The
// handler (task 8.2) resolves the effective tier with `getEffectiveTier`
// (honouring trial expiry) exactly like the service's quota guard, then asks
// this module whether the tier may send.
//
// Per design.md's "API Errors" table the gate is applied on the SEND route:
// starter / payg → 402 `upgrade_required`; growth / pro → permitted (then
// subject to the service's monthly send-quota guard). Create / list / detail /
// estimate are intentionally NOT gated here so the starter/payg teaser UI can
// still render campaign history and previews.
// ============================================================================

/** Effective tiers entitled to create and send campaigns (Requirement 9.1). */
export const CAMPAIGN_SEND_TIERS = new Set(['growth', 'pro'])

/** Upgrade copy shown to starter/payg businesses (matches design.md). */
export const CAMPAIGN_UPGRADE_MESSAGE = 'Campaigns require the Growth plan'

/**
 * 402-style upgrade-required error for starter/payg sends (Requirement 9.2).
 *
 * Extends `AppError`, so the global Fastify error handler in `app.ts`
 * serializes it to `402 { error: 'upgrade_required', message, statusCode }`
 * automatically — no special-casing in the handler.
 */
export class CampaignUpgradeRequiredError extends AppError {
  constructor(message: string = CAMPAIGN_UPGRADE_MESSAGE) {
    super(402, 'upgrade_required', message)
    this.name = 'CampaignUpgradeRequiredError'
  }
}

/** True when the effective tier may send campaigns (growth / pro). */
export function canSendCampaigns(tier: string): boolean {
  return CAMPAIGN_SEND_TIERS.has(tier)
}

/**
 * Assert the effective tier may send campaigns. Throws
 * `CampaignUpgradeRequiredError` (402 `upgrade_required`) for starter / payg /
 * free / unknown tiers, dispatching nothing (Requirements 9.2 / Property 13).
 */
export function assertCanSendCampaigns(tier: string): void {
  if (!canSendCampaigns(tier)) {
    throw new CampaignUpgradeRequiredError()
  }
}
