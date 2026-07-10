import { createHmac } from 'node:crypto'

import { qrHmacSecret, requireEnv } from '../../shared/config/env'
import { digestsEqual } from '../../shared/security/hmac'

// ============================================================================
// Win-Back Campaigns — Signed Unsubscribe Tokens
// ----------------------------------------------------------------------------
// Every campaign email carries a one-click unsubscribe link (Requirement 12.2)
// of the form:
//
//   ${AREA_CODE_API_BASE_URL}/v1/campaigns/unsubscribe?token=<signed-token>
//
// The token encodes the recipient's `userId` and the sending `businessId`,
// HMAC-signed so it cannot be forged or tampered with. The unsubscribe route
// (task 8.3, `GET /v1/campaigns/unsubscribe`) verifies the token with
// `verifyUnsubscribeToken` and writes the appropriate `COPTOUT#` row — no login
// and no phone/SMS re-auth required (Requirement 12.4).
//
// This mirrors the existing signed-state pattern used by the music OAuth flow
// (`createHmac('sha256', secret)` + base64url payload). The userId lives only
// inside the outbound email link; it is never persisted in a send record or any
// campaign/analytics document (Constraint C1 / Requirement 11.4).
//
// SEAM FOR TASK 8.3: the `GET /v1/campaigns/unsubscribe` route should import
// `verifyUnsubscribeToken` from this module, and `POST /v1/users/me/campaign-
// optout` should write the same `COPTOUT#` rows via `putOptOut` in
// `repository.ts`.
// ============================================================================

/** Env var holding the public API base URL (e.g. `https://api.areacode.co.za`). */
export const API_BASE_URL_ENV = 'AREA_CODE_API_BASE_URL'

/** Env var holding the dedicated HMAC secret for unsubscribe tokens. */
export const UNSUB_SECRET_ENV = 'AREA_CODE_CAMPAIGN_UNSUB_SECRET'

/** Truncated HMAC length (hex chars) — 32 chars / 128 bits is ample here. */
const SIG_LENGTH = 32

/**
 * Resolve the signing secret (audit-gap-closure R1.3, R1.7).
 *
 * Prefers the dedicated campaign-unsubscribe secret, falling back to the shared
 * QR HMAC secret via `qrHmacSecret()`. There is no hardcoded in-repo secret
 * literal: `qrHmacSecret()` is obtained through `requireEnv`, so in production a
 * missing `AREA_CODE_QR_HMAC_SECRET` (with no dedicated unsubscribe secret set)
 * fails fast at signing/verify time instead of degrading to a known constant.
 * DEV_MODE keeps working — `qrHmacSecret()` supplies its dev default there.
 */
function signingSecret(): string {
  return process.env[UNSUB_SECRET_ENV] ?? qrHmacSecret()
}

/** Canonical signing input for a (userId, businessId) pair. */
function signaturePayload(userId: string, businessId: string): string {
  return JSON.stringify({ u: userId, b: businessId })
}

function sign(userId: string, businessId: string): string {
  return createHmac('sha256', signingSecret())
    .update(signaturePayload(userId, businessId))
    .digest('hex')
    .slice(0, SIG_LENGTH)
}

/**
 * Produce a signed, URL-safe unsubscribe token for a recipient + business.
 *
 * The token is `base64url({ u: userId, b: businessId, s: hmac })`. It is opaque
 * to the recipient and verifiable only with the server-side secret.
 */
export function signUnsubscribeToken(userId: string, businessId: string): string {
  const token = { u: userId, b: businessId, s: sign(userId, businessId) }
  return Buffer.from(JSON.stringify(token)).toString('base64url')
}

/**
 * Verify a signed unsubscribe token, returning the embedded `userId` and
 * `businessId` when the signature is valid, or `null` when the token is
 * malformed or has been tampered with. Uses a constant-time comparison.
 */
export function verifyUnsubscribeToken(token: string): { userId: string; businessId: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString()) as {
      u?: unknown
      b?: unknown
      s?: unknown
    }
    const { u, b, s } = decoded
    if (typeof u !== 'string' || typeof b !== 'string' || typeof s !== 'string') return null

    if (!digestsEqual(s, sign(u, b))) return null

    return { userId: u, businessId: b }
  } catch {
    return null
  }
}

/**
 * Build the full one-click unsubscribe URL embedded in a campaign email.
 *
 * The base URL comes from `AREA_CODE_API_BASE_URL` (set by Terraform on the
 * sender Lambda). Obtained via `requireEnv` (audit-gap-closure R1.6,
 * `docs/decisions/prod-default-env-vars.md`): a missing base URL in production
 * fails fast rather than silently building broken one-click unsubscribe links,
 * which POPIA and anti-spam rules require to work. DEV_MODE keeps the local
 * default so dev runs and tests behave as before. The route itself is
 * implemented by the `GET /v1/campaigns/unsubscribe` handler.
 */
export function buildUnsubscribeUrl(userId: string, businessId: string): string {
  const base = requireEnv(API_BASE_URL_ENV, 'https://api.areacode.co.za').replace(/\/+$/, '')
  const token = signUnsubscribeToken(userId, businessId)
  return `${base}/v1/campaigns/unsubscribe?token=${token}`
}
