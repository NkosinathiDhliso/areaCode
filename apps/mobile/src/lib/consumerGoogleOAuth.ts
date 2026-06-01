import {
  randomPkceVerifier,
  pkceChallengeS256,
  buildHostedUiAuthorizeUrl,
  exchangeCodeForTokens,
} from '@area-code/shared/lib/cognitoHostedUiOAuth'
import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'

function apiUrl(): string {
  const v = typeof process !== 'undefined' ? process.env['EXPO_PUBLIC_API_URL']?.trim() : undefined
  return v || 'http://localhost:4000'
}

export async function signInWithGoogleConsumerMobile(): Promise<{
  accessToken: string
  refreshToken: string
  userId: string
  sessionId?: string
  isNewUser?: boolean
}> {
  const extra = Constants.expoConfig?.extra as {
    cognitoHostedUiDomain?: string
    cognitoConsumerClientId?: string
  }
  const domain = extra?.cognitoHostedUiDomain?.trim()
  const clientId = extra?.cognitoConsumerClientId?.trim()
  if (!domain || !clientId) throw new Error('missing_cognito_oauth')

  const verifier = randomPkceVerifier()
  const challenge = await pkceChallengeS256(verifier)
  const state = globalThis.crypto.randomUUID()
  const redirectUri = Linking.createURL('auth/callback')

  const url = buildHostedUiAuthorizeUrl({
    domain,
    clientId,
    redirectUri,
    identityProvider: 'Google',
    codeChallenge: challenge,
    state,
  })

  const result = await WebBrowser.openAuthSessionAsync(url, redirectUri)
  if (result.type !== 'success' || !('url' in result) || !result.url) {
    throw new Error('oauth_cancelled')
  }

  const returned = new URL(result.url)
  if (returned.searchParams.get('state') !== state) throw new Error('oauth_state')

  const code = returned.searchParams.get('code')
  if (!code) throw new Error('oauth_no_code')

  const tokens = await exchangeCodeForTokens({
    domain,
    clientId,
    redirectUri,
    code,
    codeVerifier: verifier,
  })

  const syncRes = await fetch(`${apiUrl()}/v1/auth/consumer/oauth-sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  })

  if (!syncRes.ok) throw new Error(`sync_${syncRes.status}`)
  const sync = (await syncRes.json()) as { userId: string; sessionId?: string; isNewUser?: boolean }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    userId: sync.userId,
    sessionId: sync.sessionId,
    isNewUser: sync.isNewUser,
  }
}
