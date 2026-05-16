import {
  randomPkceVerifier,
  pkceChallengeS256,
  buildHostedUiAuthorizeUrl,
} from '@area-code/shared/lib/cognitoHostedUiOAuth'

export async function startAdminGoogleOAuthWeb(): Promise<void> {
  const domain = (import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN_ADMIN'] as string | undefined)?.trim()
  const clientId = (import.meta.env['VITE_COGNITO_CLIENT_ID_ADMIN'] as string | undefined)?.trim()
  if (!domain || !clientId) throw new Error('missing_cognito_oauth_env')

  const verifier = randomPkceVerifier()
  const challenge = await pkceChallengeS256(verifier)
  const state = crypto.randomUUID()
  sessionStorage.setItem('admin_oauth_pkce', verifier)
  sessionStorage.setItem('admin_oauth_state', state)
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
