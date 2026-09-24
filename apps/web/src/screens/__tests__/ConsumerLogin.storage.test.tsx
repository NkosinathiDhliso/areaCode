/**
 * The sign-in screen says what is wrong when storage is blocked
 * (proof-of-demand R15.19).
 *
 * A private-mode browser cannot keep the OAuth state, so the start throws before
 * redirecting. The screen has to name that, and keep it distinct from a missing
 * deployment configuration, which the user can do nothing about.
 *
 * react-i18next is not initialised in unit tests, so `t(key, fallback)` returns
 * the inline English fallback, which is what we assert on.
 *
 * **Validates: Requirements 15.19**
 */
// @vitest-environment jsdom
import { SIGN_IN_STORAGE_REQUIRED_COPY } from '@area-code/shared/lib/safeStorage'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startOAuth = vi.fn()
vi.mock('../../lib/startConsumerGoogleOAuth', () => ({
  OAUTH_STORAGE_UNAVAILABLE: 'oauth_storage_unavailable',
  startConsumerGoogleOAuthWeb: () => startOAuth(),
}))
vi.mock('@area-code/shared/lib/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }))
vi.mock('@area-code/shared/lib/usageEvents', () => ({ trackEvent: vi.fn() }))

import { ConsumerLogin } from '../ConsumerLogin'

function clickGoogle() {
  render(<ConsumerLogin onNavigate={vi.fn()} />)
  screen.getByRole('button', { name: 'Continue with Google' }).click()
}

beforeEach(() => {
  startOAuth.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('Google sign-in with storage blocked', () => {
  it('tells the user to turn off Private Browsing', async () => {
    startOAuth.mockRejectedValue(new Error('oauth_storage_unavailable'))
    clickGoogle()
    await waitFor(() => {
      expect(screen.getByText(SIGN_IN_STORAGE_REQUIRED_COPY)).toBeTruthy()
    })
  })

  it('keeps a missing configuration as its own message', async () => {
    startOAuth.mockRejectedValue(new Error('missing_cognito_oauth_env'))
    clickGoogle()
    await waitFor(() => {
      expect(screen.getByText('Google sign-in is not configured for this deployment.')).toBeTruthy()
    })
  })
})
