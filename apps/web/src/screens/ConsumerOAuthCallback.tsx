import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { exchangeCodeForTokens } from '@area-code/shared/lib/cognitoHostedUiOAuth'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { Spinner } from '@area-code/shared/components/Spinner'

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
      const oauthErr = params.get('error_description') ?? params.get('error')

      if (oauthErr) {
        setError(oauthErr)
        return
      }
      if (!code || !state) {
        setError(t('auth.oauth.missingParams', 'Missing sign-in response. Try again.'))
        return
      }

      const storedState = sessionStorage.getItem('consumer_oauth_state')
      const verifier = sessionStorage.getItem('consumer_oauth_pkce')
      if (!storedState || !verifier || state !== storedState) {
        setError(t('auth.oauth.stateMismatch', 'Sign-in expired. Please try again.'))
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
        sessionStorage.removeItem('consumer_oauth_state')
        sessionStorage.removeItem('consumer_oauth_pkce')

        const syncRes = await fetch(`${apiBase()}/v1/auth/consumer/oauth-sync`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
          },
        })

        if (!syncRes.ok) {
          const body = (await syncRes.json().catch(() => null)) as { message?: string } | null
          throw new Error(body?.message ?? `sync_failed_${syncRes.status}`)
        }

        const sync = (await syncRes.json()) as {
          userId: string
          sessionId?: string
          username: string
          displayName: string
        }

        if (cancelled) return

        setAuth(tokens.access_token, tokens.refresh_token, sync.userId, sync.sessionId)
        window.history.replaceState({}, '', '/map')
        onNavigate('map')
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
