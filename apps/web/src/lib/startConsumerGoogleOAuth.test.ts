/**
 * Consumer Google sign-in refuses to leave when it cannot keep its state
 * (proof-of-demand R15.19).
 *
 * The hosted UI round trip only works if the PKCE verifier and the state survive
 * in sessionStorage. A private-mode browser throws on write, so starting the
 * redirect anyway would come back as a state mismatch and read as a broken
 * sign-in. The start stops before navigating and reports the real reason.
 *
 * jsdom for `window.location` and `sessionStorage`; the PKCE helpers are mocked
 * so the test needs no `crypto.subtle`.
 *
 * **Validates: Requirements 15.19**
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@area-code/shared/lib/cognitoHostedUiOAuth', () => ({
  randomPkceVerifier: () => 'verifier-123',
  pkceChallengeS256: async () => 'challenge-123',
  buildHostedUiAuthorizeUrl: () => 'https://auth.example.com/authorize',
}))

import {
  CONSUMER_OAUTH_PKCE_KEY,
  CONSUMER_OAUTH_STATE_KEY,
  OAUTH_STORAGE_UNAVAILABLE,
  startConsumerGoogleOAuthWeb,
} from './startConsumerGoogleOAuth'

const realSession = window.sessionStorage
const location = { origin: 'https://areacode.co.za', href: '' }

beforeEach(() => {
  vi.stubEnv('VITE_COGNITO_HOSTED_UI_DOMAIN', 'auth.example.com')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID_CONSUMER', 'client-abc')
  Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true })
  location.href = ''
  Object.defineProperty(window, 'crypto', {
    value: { ...window.crypto, randomUUID: () => 'state-abc' },
    configurable: true,
  })
})

afterEach(() => {
  Object.defineProperty(window, 'sessionStorage', { value: realSession, configurable: true })
  realSession.clear()
  vi.unstubAllEnvs()
})

function throwingSessionStorage(): void {
  const boom = () => {
    throw new DOMException('denied', 'QuotaExceededError')
  }
  Object.defineProperty(window, 'sessionStorage', {
    value: { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 },
    configurable: true,
  })
}

describe('startConsumerGoogleOAuthWeb', () => {
  it('stores the verifier and state, then leaves for the hosted UI', async () => {
    await startConsumerGoogleOAuthWeb()
    expect(realSession.getItem(CONSUMER_OAUTH_PKCE_KEY)).toBe('verifier-123')
    expect(realSession.getItem(CONSUMER_OAUTH_STATE_KEY)).toBe('state-abc')
    expect(location.href).toBe('https://auth.example.com/authorize')
  })

  it('does not navigate when storage cannot keep the state', async () => {
    throwingSessionStorage()
    await expect(startConsumerGoogleOAuthWeb()).rejects.toThrow(OAUTH_STORAGE_UNAVAILABLE)
    expect(location.href).toBe('')
  })

  it('still reports a missing configuration separately', async () => {
    vi.stubEnv('VITE_COGNITO_HOSTED_UI_DOMAIN', '')
    await expect(startConsumerGoogleOAuthWeb()).rejects.toThrow('missing_cognito_oauth_env')
    expect(location.href).toBe('')
  })
})
