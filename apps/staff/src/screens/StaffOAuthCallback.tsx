import { Spinner } from '@area-code/shared/components/Spinner'
import { describeApiError, describeOAuthError } from '@area-code/shared/lib/apiError'
import { exchangeCodeForTokens } from '@area-code/shared/lib/cognitoHostedUiOAuth'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useStaffAuthStore } from '../stores/staffAuthStore'

function hostedUiDomain(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN_STAFF'] as string | undefined
  return v?.trim() || undefined
}

function staffClientId(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_CLIENT_ID_STAFF'] as string | undefined
  return v?.trim() || undefined
}

function apiBase(): string {
  return (import.meta.env['VITE_API_URL'] as string | undefined)?.trim() || 'http://localhost:4000'
}

export function StaffOAuthCallback() {
  const { t } = useTranslation()
  const setAuth = useStaffAuthStore((s) => s.setAuth)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const domain = hostedUiDomain()
      const clientId = staffClientId()
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
        console.warn('[staff-oauth] callback error', { code: oauthErrCode, detail: oauthErrDetail })
        setError(describeOAuthError(oauthErrCode))
        return
      }
      if (!code || !state) {
        setError(t('auth.oauth.missingParams', 'Missing sign-in response. Try again.'))
        return
      }

      const storedState = sessionStorage.getItem('staff_oauth_state')
      const verifier = sessionStorage.getItem('staff_oauth_pkce')
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
        sessionStorage.removeItem('staff_oauth_state')
        sessionStorage.removeItem('staff_oauth_pkce')

        const inviteToken = sessionStorage.getItem('staff_oauth_invite_token')
        const inviteName = sessionStorage.getItem('staff_oauth_invite_name')

        const path = inviteToken && inviteName ? '/v1/auth/staff/oauth-accept-invite' : '/v1/auth/staff/oauth-sync'

        const body = inviteToken && inviteName ? JSON.stringify({ inviteToken, name: inviteName.trim() }) : undefined

        const syncRes = await fetch(`${apiBase()}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body } : {}),
        })

        if (!syncRes.ok) {
          // Thrown in the shape the shared API client throws, so the catch below
          // describes it the same way every other failure is described.
          const errBody = (await syncRes.json().catch(() => null)) as { message?: string; error?: string } | null
          throw {
            statusCode: syncRes.status,
            error: errBody?.error ?? 'sync_failed',
            message: errBody?.message ?? '',
          }
        }

        sessionStorage.removeItem('staff_oauth_invite_token')
        sessionStorage.removeItem('staff_oauth_invite_name')

        const sync = (await syncRes.json()) as {
          staff: { id: string; name: string; businessId: string }
        }

        if (cancelled) return

        setAuth(tokens.access_token, tokens.refresh_token, sync.staff.id, sync.staff.businessId, sync.staff.name)
        window.history.replaceState({}, '', '/')
      } catch (err) {
        if (cancelled) return
        // Surface the server's specific reason (wrong Google email, invite
        // expired or already used, staff limit reached) when it reads as copy a
        // person can act on, and the mapped line otherwise. A token-exchange or
        // network failure carries technical text that must never render (R15.13).
        setError(describeApiError(err, t('auth.oauth.failed', 'Google sign-in failed. Try again.')))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [setAuth, t])

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
            onClick={() => {
              window.history.replaceState({}, '', '/')
              window.location.reload()
            }}
            className="text-[var(--accent)] text-sm active:scale-95"
          >
            {t('auth.oauth.backToLogin', 'Back to sign in')}
          </button>
        </>
      )}
    </div>
  )
}
