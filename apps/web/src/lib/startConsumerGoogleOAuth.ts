import {
  randomPkceVerifier,
  pkceChallengeS256,
  buildHostedUiAuthorizeUrl,
} from '@area-code/shared/lib/cognitoHostedUiOAuth'
import { removeStored, writeStored } from '@area-code/shared/lib/safeStorage'

/** sessionStorage keys the callback reads back after the hosted UI round trip. */
export const CONSUMER_OAUTH_PKCE_KEY = 'consumer_oauth_pkce'
export const CONSUMER_OAUTH_STATE_KEY = 'consumer_oauth_state'

/**
 * Thrown before leaving for the hosted UI when the PKCE verifier and state
 * cannot be stored (Safari Private Browsing, blocked storage). Sending the user
 * anyway guarantees a state mismatch on return, so we stop here and let the
 * caller show `SIGN_IN_STORAGE_REQUIRED_COPY` (R15.19).
 */
export const OAUTH_STORAGE_UNAVAILABLE = 'oauth_storage_unavailable'

export async function startConsumerGoogleOAuthWeb(): Promise<void> {
  const domain = (import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN'] as string | undefined)?.trim()
  const clientId = (import.meta.env['VITE_COGNITO_CLIENT_ID_CONSUMER'] as string | undefined)?.trim()
  if (!domain || !clientId) throw new Error('missing_cognito_oauth_env')

  const verifier = randomPkceVerifier()
  const challenge = await pkceChallengeS256(verifier)
  const state = crypto.randomUUID()
  const pkceStored = writeStored('session', CONSUMER_OAUTH_PKCE_KEY, verifier)
  const stateStored = writeStored('session', CONSUMER_OAUTH_STATE_KEY, state)
  if (!pkceStored || !stateStored) {
    // Half a pair is worse than none: a later attempt would read a verifier that
    // belongs to an abandoned redirect.
    removeStored('session', CONSUMER_OAUTH_PKCE_KEY)
    removeStored('session', CONSUMER_OAUTH_STATE_KEY)
    throw new Error(OAUTH_STORAGE_UNAVAILABLE)
  }
  const redirectUri = `${window.location.origin}/auth/callback`
  window.location.href = buildHostedUiAuthorizeUrl({
    domain,
    clientId,
    redirectUri,
    identityProvider: 'Google',
    codeChallenge: challenge,
    state,
  })
}
