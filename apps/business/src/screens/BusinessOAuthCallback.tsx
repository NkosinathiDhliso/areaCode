import { Spinner } from '@area-code/shared/components/Spinner'
import { exchangeCodeForTokens } from '@area-code/shared/lib/cognitoHostedUiOAuth'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

function hostedUiDomain(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS'] as string | undefined
  return v?.trim() || undefined
}

function businessClientId(): string | undefined {
  const v = import.meta.env['VITE_COGNITO_CLIENT_ID_BUSINESS'] as string | undefined
  return v?.trim() || undefined
}

function apiBase(): string {
  return (import.meta.env['VITE_API_URL'] as string | undefined)?.trim() || 'http://localhost:4000'
}

export function BusinessOAuthCallback() {
  const { t } = useTranslation()
  const setAuth = useBusinessAuthStore((s) => s.setAuth)
  const [error, setError] = useState<string | null>(null)
  const [needsProfile, setNeedsProfile] = useState(false)
  const [tokens, setTokens] = useState<{ access: string; refresh: string } | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [profileSubmitting, setProfileSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const domain = hostedUiDomain()
      const clientId = businessClientId()
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

      const storedState = sessionStorage.getItem('business_oauth_state')
      const verifier = sessionStorage.getItem('business_oauth_pkce')
      if (!storedState || !verifier || state !== storedState) {
        setError(t('auth.oauth.stateMismatch', 'Sign-in expired. Please try again.'))
        return
      }

      const redirectUri = `${window.location.origin}/auth/callback`

      try {
        const tok = await exchangeCodeForTokens({
          domain,
          clientId,
          redirectUri,
          code,
          codeVerifier: verifier,
        })
        sessionStorage.removeItem('business_oauth_state')
        sessionStorage.removeItem('business_oauth_pkce')

        if (cancelled) return

        setTokens({ access: tok.access_token, refresh: tok.refresh_token })

        const syncRes = await fetch(`${apiBase()}/v1/auth/business/oauth-sync`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tok.access_token}`,
          },
        })

        if (!syncRes.ok) {
          const body = (await syncRes.json().catch(() => null)) as { message?: string } | null
          throw new Error(body?.message ?? `sync_failed_${syncRes.status}`)
        }

        const sync = (await syncRes.json()) as {
          needsBusinessProfile: boolean
          businessId?: string
        }

        if (cancelled) return

        if (sync.needsBusinessProfile) {
          setNeedsProfile(true)
          return
        }

        if (!sync.businessId) throw new Error('missing_business_id')

        setAuth(tok.access_token, tok.refresh_token, sync.businessId)
        window.history.replaceState({}, '', '/')
      } catch {
        if (!cancelled) setError(t('auth.oauth.failed', 'Google sign-in failed. Try again.'))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [setAuth, t])

  async function submitProfile() {
    if (!tokens || !businessName.trim()) return
    setProfileSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase()}/v1/auth/business/oauth-complete-profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          businessName: businessName.trim(),
          ...(registrationNumber.trim() ? { registrationNumber: registrationNumber.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        if (res.status === 409) {
          setError(t('biz.oauth.accountExists', 'This Google account is already linked to a business. Sign in instead.'))
          return
        }
        throw new Error(body?.message ?? `profile_failed_${res.status}`)
      }
      const body = (await res.json()) as { businessId: string }
      setAuth(tokens.access, tokens.refresh, body.businessId)
      window.history.replaceState({}, '', '/')
    } catch {
      setError(t('biz.oauth.profileFailed', 'Could not complete registration. Try again.'))
    } finally {
      setProfileSubmitting(false)
    }
  }

  if (needsProfile && tokens) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5 py-10">
        <h1 className="text-[var(--text-primary)] font-bold text-xl mb-6 font-[Syne] text-center">
          {t('biz.oauth.completeProfile', 'Complete your business profile')}
        </h1>
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder={t('biz.signup.businessName', 'Business name')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="text"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder={t('biz.signup.registrationOptional', 'Registration number (optional)')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void submitProfile()}
            disabled={profileSubmitting || !businessName.trim()}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {profileSubmitting ? (
              <Spinner size="sm" className="border-white border-t-transparent" />
            ) : (
              t('biz.oauth.continue', 'Continue')
            )}
          </button>
        </div>
        {error && (
          <div className="flex flex-col items-center gap-3 mt-4">
            <p className="text-xs text-[var(--danger)] text-center">{error}</p>
            {error.includes('already linked') && (
              <button
                type="button"
                onClick={() => {
                  window.history.replaceState({}, '', '/')
                  window.location.reload()
                }}
                className="text-[var(--accent)] text-xs active:scale-95"
              >
                {t('biz.oauth.signIn', 'Sign in')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

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
