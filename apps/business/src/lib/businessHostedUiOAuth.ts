import {
  randomPkceVerifier,
  pkceChallengeS256,
  buildHostedUiAuthorizeUrl,
} from '@area-code/shared/lib/cognitoHostedUiOAuth'

function businessOAuthEnv(): { domain: string; clientId: string } | null {
  const domain = (import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS'] as string | undefined)?.trim()
  const clientId = (import.meta.env['VITE_COGNITO_CLIENT_ID_BUSINESS'] as string | undefined)?.trim()
  if (!domain || !clientId) return null
  return { domain, clientId }
}

/** Hosted UI with Google IdP only. */
export async function startBusinessGoogleOAuthWeb(): Promise<void> {
  const cfg = businessOAuthEnv()
  if (!cfg) throw new Error('missing_cognito_oauth_env')

  const verifier = randomPkceVerifier()
  const challenge = await pkceChallengeS256(verifier)
  const state = crypto.randomUUID()
  sessionStorage.setItem('business_oauth_pkce', verifier)
  sessionStorage.setItem('business_oauth_state', state)
  const redirectUri = `${window.location.origin}/auth/callback`
  window.location.href = buildHostedUiAuthorizeUrl({
    domain: cfg.domain,
    clientId: cfg.clientId,
    redirectUri,
    identityProvider: 'Google',
    codeChallenge: challenge,
    state,
  })
}

/** Cognito Hosted UI sign-in / sign-up (email or federated buttons Cognito shows). */
export async function startBusinessCognitoHostedUiWeb(): Promise<void> {
  const cfg = businessOAuthEnv()
  if (!cfg) throw new Error('missing_cognito_oauth_env')

  const verifier = randomPkceVerifier()
  const challenge = await pkceChallengeS256(verifier)
  const state = crypto.randomUUID()
  sessionStorage.setItem('business_oauth_pkce', verifier)
  sessionStorage.setItem('business_oauth_state', state)
  const redirectUri = `${window.location.origin}/auth/callback`
  window.location.href = buildHostedUiAuthorizeUrl({
    domain: cfg.domain,
    clientId: cfg.clientId,
    redirectUri,
    codeChallenge: challenge,
    state,
  })
}

function staffOAuthEnv(): { domain: string; clientId: string } | null {
  const domain = (import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN_STAFF'] as string | undefined)?.trim()
  const clientId = (import.meta.env['VITE_COGNITO_CLIENT_ID_STAFF'] as string | undefined)?.trim()
  if (!domain || !clientId) return null
  return { domain, clientId }
}

/**
 * Manager Google sign-in. Managers live in the STAFF Cognito pool (they accept
 * their invite in the staff app), but operate the business dashboard. This
 * starts the staff Hosted UI and marks the flow so the callback syncs against
 * the staff pool and stores the session as a manager.
 */
export async function startManagerGoogleOAuthWeb(): Promise<void> {
  const cfg = staffOAuthEnv()
  if (!cfg) throw new Error('missing_cognito_oauth_env')

  const verifier = randomPkceVerifier()
  const challenge = await pkceChallengeS256(verifier)
  const state = crypto.randomUUID()
  sessionStorage.setItem('business_oauth_pkce', verifier)
  sessionStorage.setItem('business_oauth_state', state)
  sessionStorage.setItem('business_oauth_manager', '1')
  const redirectUri = `${window.location.origin}/auth/callback`
  window.location.href = buildHostedUiAuthorizeUrl({
    domain: cfg.domain,
    clientId: cfg.clientId,
    redirectUri,
    identityProvider: 'Google',
    codeChallenge: challenge,
    state,
  })
}
