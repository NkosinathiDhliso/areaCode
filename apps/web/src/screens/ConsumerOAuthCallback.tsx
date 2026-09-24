import { Spinner } from '@area-code/shared/components/Spinner'
import { describeOAuthError } from '@area-code/shared/lib/apiError'
import { exchangeCodeForTokens } from '@area-code/shared/lib/cognitoHostedUiOAuth'
import {
  SIGN_IN_STORAGE_REQUIRED_COPY,
  isStorageAvailable,
  readStored,
  removeStored,
} from '@area-code/shared/lib/safeStorage'
import { trackEvent } from '@area-code/shared/lib/usageEvents'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CONSUMER_OAUTH_PKCE_KEY, CONSUMER_OAUTH_STATE_KEY } from '../lib/startConsumerGoogleOAuth'
import type { AppRoute } from '../types'

interface ConsumerOAuthCallbackProps {
  onNavigate: (route: AppRoute) => void
}

function hostedUiDomain(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN'] as string | undefined
  return v?.trim() || undefined
}

function consumerClientId(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_CLIENT_ID_CONSUMER'] as string | undefined
  return v?.trim() || undefined
}

function apiBase(): string {
  return (import.meta.env['VITE_API_URL'] as string | undefined)?.trim() || 'http://localhost:4000'
}

export function ConsumerOAuthCallback({ onNavigate }: ConsumerOAuthCallbackProps) {
  const { t } = useTranslation()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const domain = hostedUiDomain()
      const clientId = consumerClientId()
      if (!domain || !clientId) {
        setError(t('auth.oauth.misconfigured', 'Sign-in is not configured. Try again later.'))
        return
      }

      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const state = params.get('state')
      const oauthErrCode = params.get('error')
      const oauthErrDetail = params.get('error_description')

      if (oauthErrCode !== null || oauthErrDetail !== null) {
        // Cognito's `error_description` is machinery: logged, never rendered (R15.13).
        console.warn('[consumer-oauth] callback error', { code: oauthErrCode, detail: oauthErrDetail })
        setError(describeOAuthError(oauthErrCode))
        return
      }
      if (!code || !state) {
        setError(t('auth.oauth.missingParams', 'Missing sign-in response. Try again.'))
        return
      }

      const storedState = readStored('session', CONSUMER_OAUTH_STATE_KEY)
      const verifier = readStored('session', CONSUMER_OAUTH_PKCE_KEY)
      if (!storedState || !verifier || state !== storedState) {
        // No storage at all is a different story from an expired attempt: the
        // round trip could never have kept the state, so say so (R15.19).
        setError(
          isStorageAvailable('session')
            ? t('auth.oauth.stateMismatch', 'Sign-in expired. Please try again.')
            : t('auth.oauth.storageBlocked', SIGN_IN_STORAGE_REQUIRED_COPY),
        )
        return
      }

      const redirectUri = `${window.location.origin}/auth/callback`

      try {
        const tokens = await exchangeCodeForTokens({
          domain,
          clientId,
          redirectUri,
          code,
          codeVerifier: verifier,
        })
        removeStored('session', CONSUMER_OAUTH_STATE_KEY)
        removeStored('session', CONSUMER_OAUTH_PKCE_KEY)

        const syncRes = await fetch(`${apiBase()}/v1/auth/consumer/oauth-sync`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
          },
        })

        if (!syncRes.ok) {
          const body = (await syncRes.json().catch(() => null)) as { message?: string } | null
          throw new Error(body?.message ?? `sync_failed_${syncRes.status}`)
        }

        const sync = (await syncRes.json()) as {
          userId: string
          username: string
          displayName: string
          isNewUser?: boolean
        }

        if (cancelled) return

        setAuth(tokens.access_token, tokens.refresh_token, sync.userId)
        // Signup funnel completion for the Google OAuth path: a brand-new user
        // is a signup, a returning user is a sign-in (R4.1). Beacon gates on
        // consent (R4.2).
        if (sync.isNewUser) {
          trackEvent('signup_completed', { method: 'google' })
        }
        // Route new users through the First-Get prompt; everyone else lands on the map.
        if (sync.isNewUser) {
          window.history.replaceState({}, '', '/first-get-prompt')
          onNavigate('first-get-prompt')
        } else {
          window.history.replaceState({}, '', '/map')
          onNavigate('map')
        }
      } catch {
        if (!cancelled) setError(t('auth.oauth.failed', 'Google sign-in failed. Try again.'))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [onNavigate, setAuth, t])

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-xl mb-6 font-[Syne]">
        {t('auth.oauth.finishing', 'Finishing sign-in…')}
      </h1>
      {!error ? (
        <Spinner size="lg" />
      ) : (
        <>
          <p className="text-[var(--danger)] text-sm text-center mb-6">{error}</p>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="text-[var(--accent)] text-sm active:scale-95"
          >
            {t('auth.oauth.backToLogin', 'Back to sign in')}
          </button>
        </>
      )}
    </div>
  )
}
