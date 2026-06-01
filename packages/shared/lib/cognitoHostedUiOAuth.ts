/** PKCE + Cognito Hosted UI helpers (optional IdP; omit for Cognito default sign-in/sign-up UI). */

const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

// ─── Pluggable crypto provider ────────────────────────────────────────────────
// PKCE needs CSPRNG bytes and a SHA-256 digest, and the OAuth `state` needs a
// random UUID. On web these come from Web Crypto (`crypto.getRandomValues`,
// `crypto.subtle.digest`, `crypto.randomUUID`) plus `btoa`/`TextEncoder`, all of
// which are always present in browsers.
//
// React Native (Hermes) does not reliably provide Web Crypto, `btoa`, or
// `TextEncoder`, so the native app injects an `expo-crypto`-backed provider at
// boot via `setOAuthCryptoProvider`. The provider exposes a *high-level*
// `sha256Base64Url` so the native path never depends on `btoa`/`TextEncoder`.
// The default below uses Web Crypto, so web behaviour is byte-for-byte unchanged.
export interface OAuthCryptoProvider {
  /** Fill the given array with cryptographically-secure random bytes. */
  getRandomValues(buf: Uint8Array): Uint8Array
  /** Return the base64url-encoded (no padding) SHA-256 digest of a UTF-8 string. */
  sha256Base64Url(input: string): Promise<string>
  /** Generate a random UUID (used for the OAuth `state` value). */
  randomUUID(): string
}

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const webCryptoProvider: OAuthCryptoProvider = {
  getRandomValues: (buf) => crypto.getRandomValues(buf),
  sha256Base64Url: async (input) => {
    const data = new TextEncoder().encode(input)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return base64UrlEncode(digest)
  },
  randomUUID: () => crypto.randomUUID(),
}

let cryptoProvider: OAuthCryptoProvider = webCryptoProvider

/**
 * Override the crypto provider used by the PKCE helpers. Call once at app boot
 * on platforms without Web Crypto (React Native). No-op on web, which keeps the
 * default Web Crypto provider.
 */
export function setOAuthCryptoProvider(provider: OAuthCryptoProvider): void {
  cryptoProvider = provider
}

/** Generate a random UUID suitable for the OAuth `state` parameter. */
export function oauthRandomState(): string {
  return cryptoProvider.randomUUID()
}

export function randomPkceVerifier(length = 64): string {
  const buf = new Uint8Array(length)
  cryptoProvider.getRandomValues(buf)
  let s = ''
  for (let i = 0; i < length; i++) s += PKCE_CHARSET[buf[i]! % PKCE_CHARSET.length]
  return s
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  return cryptoProvider.sha256Base64Url(verifier)
}

export function buildHostedUiAuthorizeUrl(opts: {
  domain: string
  clientId: string
  redirectUri: string
  /** When set (e.g. `Google`), skips Cognito login page and sends user to that IdP. */
  identityProvider?: string
  codeChallenge: string
  state: string
}): string {
  const base = `https://${opts.domain}/oauth2/authorize`
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: opts.codeChallenge,
    state: opts.state,
  })
  if (opts.identityProvider) {
    p.set('identity_provider', opts.identityProvider)
  }
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
