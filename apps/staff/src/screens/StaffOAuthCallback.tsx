import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { exchangeCodeForTokens } from '@area-code/shared/lib/cognitoHostedUiOAuth'
import { useStaffAuthStore } from '../stores/staffAuthStore'
import { Spinner } from '@area-code/shared/components/Spinner'

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
      const oauthErr = params.get('error_description') ?? params.get('error')

      if (oauthErr) {
        setError(oauthErr)
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
          const errBody = (await syncRes.json().catch(() => null)) as { message?: string } | null
          throw new Error(errBody?.message ?? `sync_failed_${syncRes.status}`)
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
        // expired/already used, staff limit reached) instead of a generic
        // failure. Only fall back to the generic copy for opaque errors
        // (token exchange, network) that carry no useful message.
        const message = err instanceof Error ? err.message : ''
        const generic = t('auth.oauth.failed', 'Google sign-in failed. Try again.')
        setError(message && !message.startsWith('sync_failed_') ? message : generic)
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
