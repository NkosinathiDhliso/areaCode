import { useEffect, useState } from 'react'

import { exchangeCodeForTokens } from '@area-code/shared/lib/cognitoHostedUiOAuth'
import type { AdminRole } from '@area-code/shared/types'
import { Spinner } from '@area-code/shared/components/Spinner'
import { useAdminAuthStore } from '../stores/adminAuthStore'

function hostedUiDomain(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN_ADMIN'] as string | undefined
  return v?.trim() || undefined
}

function adminClientId(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_CLIENT_ID_ADMIN'] as string | undefined
  return v?.trim() || undefined
}

function apiBase(): string {
  return (import.meta.env['VITE_API_URL'] as string | undefined)?.trim() || 'http://localhost:4000'
}

export function AdminOAuthCallback() {
  const setAuth = useAdminAuthStore((s) => s.setAuth)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const domain = hostedUiDomain()
      const clientId = adminClientId()
      if (!domain || !clientId) {
        setError('Sign-in is not configured. Try again later.')
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
        setError('Missing sign-in response. Try again.')
        return
      }

      const storedState = sessionStorage.getItem('admin_oauth_state')
      const verifier = sessionStorage.getItem('admin_oauth_pkce')
      if (!storedState || !verifier || state !== storedState) {
        setError('Sign-in expired. Please try again.')
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
        sessionStorage.removeItem('admin_oauth_state')
        sessionStorage.removeItem('admin_oauth_pkce')

        const syncRes = await fetch(`${apiBase()}/v1/auth/admin/oauth-sync`, {
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

        const sync = (await syncRes.json()) as { adminId: string; role: AdminRole }

        if (cancelled) return

        setAuth(tokens.access_token, tokens.refresh_token, sync.adminId, sync.role)
        window.history.replaceState({}, '', '/')
      } catch {
        if (!cancelled) setError('Google sign-in failed. Try again.')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [setAuth])

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-xl mb-6 font-[Syne]">
        Finishing sign-in…
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
            Back to sign in
          </button>
        </>
      )}
    </div>
  )
}
