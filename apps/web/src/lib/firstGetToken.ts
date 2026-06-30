import { api } from '@area-code/shared/lib/api'

/**
 * First-Get token helpers - the single home for the casual-customer token
 * format and its redemption call. Tokens are 8-character Crockford base32
 * (no I, L, O, U), per `backend/src/features/rewards/guest-claim.ts` and the
 * churn-defences spec (Requirement 6).
 *
 * Both consumer signup entry points use these:
 *   - `ConsumerLogin` (the single email/password screen, which also creates the
 *     account when none exists) redeems an optional token inline after signup.
 *   - `FirstGetPrompt` (the post-Google-OAuth prompt) redeems a token for the
 *     OAuth signup branch, which has no pre-auth field to type one into.
 */

/** Token length: 8 Crockford base32 characters. */
export const FIRST_GET_TOKEN_LENGTH = 8

/**
 * Normalise raw input to the token alphabet: uppercase and strip anything that
 * is not a Crockford base32 character (excludes I, L, O, U).
 */
export function cleanFirstGetToken(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
}

/** Whether a cleaned token is a complete, well-formed First-Get code. */
export function isCompleteFirstGetToken(token: string): boolean {
  return cleanFirstGetToken(token).length === FIRST_GET_TOKEN_LENGTH
}

/**
 * Redeem a First-Get token for the currently-authenticated consumer. Throws on
 * failure so the caller can decide whether the failure is fatal (it never is
 * for these flows - the account is already usable without the token).
 */
export async function redeemFirstGetToken(token: string): Promise<void> {
  await api.post('/v1/users/me/redeem-guest-token', { token: cleanFirstGetToken(token) })
}
