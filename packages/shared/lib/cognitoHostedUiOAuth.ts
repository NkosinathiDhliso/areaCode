/** PKCE + Cognito Hosted UI helpers for Google IdP (consumer pool). */

const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

export function randomPkceVerifier(length = 64): string {
  const buf = new Uint8Array(length)
  crypto.getRandomValues(buf)
  let s = ''
  for (let i = 0; i < length; i++) s += PKCE_CHARSET[buf[i]! % PKCE_CHARSET.length]
  return s
}

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(digest)
}

export function buildHostedUiAuthorizeUrl(opts: {
  domain: string
  clientId: string
  redirectUri: string
  identityProvider: string
  codeChallenge: string
  state: string
}): string {
  const base = `https://${opts.domain}/oauth2/authorize`
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    identity_provider: opts.identityProvider,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: opts.codeChallenge,
    state: opts.state,
  })
  return `${base}?${p.toString()}`
}

export async function exchangeCodeForTokens(opts: {
  domain: string
  clientId: string
  redirectUri: string
  code: string
  codeVerifier: string
}): Promise<{ access_token: string; refresh_token: string; id_token: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  })
  const res = await fetch(`https://${opts.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`token_exchange_failed:${res.status}:${text.slice(0, 120)}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; id_token: string }>
}
