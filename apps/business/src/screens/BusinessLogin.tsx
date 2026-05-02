import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startBusinessGoogleOAuthWeb } from '../lib/businessHostedUiOAuth'

interface BusinessLoginProps {
  onSwitchToSignup: () => void
}

export function BusinessLogin({ onSwitchToSignup }: BusinessLoginProps) {
  const { t } = useTranslation()
  const setAuth = useBusinessAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEnvHint, setShowEnvHint] = useState(false)

  async function handleEmailLogin() {
    setLoading(true)
    setError(null)
    setShowEnvHint(false)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        businessId: string
      }>('/v1/auth/business/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.businessId)
    } catch {
      setError(t('biz.login.emailFailed', 'Invalid email or password.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    setShowEnvHint(false)
    try {
      await startBusinessGoogleOAuthWeb()
    } catch {
      setGoogleLoading(false)
      setError(t('auth.oauth.misconfigured', 'Google sign-in is not configured for this deployment.'))
      setShowEnvHint(true)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">{t('biz.login.title')}</h1>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          type="button"
          onClick={() => void handleGoogle()}
          disabled={googleLoading || loading}
          className="flex items-center justify-center gap-3 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
        >
          {googleLoading ? (
            <Spinner size="sm" className="border-[var(--accent)] border-t-transparent" />
          ) : (
            t('auth.login.continueGoogle', 'Continue with Google')
          )}
        </button>

        <p className="text-center text-[var(--text-muted)] text-xs">or use email and password</p>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('biz.login.email', 'Email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('biz.login.password', 'Password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleEmailLogin()}
          disabled={loading || googleLoading || !email || !password}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('biz.login.submitEmail', 'Sign in')
          )}
        </button>
      </div>

      {error && (
        <div className="mt-4 max-w-xs text-center">
          <p className="text-xs text-[var(--danger)]">{error}</p>
          {showEnvHint && (
            <p className="text-[var(--text-muted)] text-[11px] mt-2 leading-snug">
              {t(
                'biz.oauth.envHint',
                'Set VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS and VITE_COGNITO_CLIENT_ID_BUSINESS for Google auth.',
              )}
            </p>
          )}
        </div>
      )}

      <button type="button" onClick={onSwitchToSignup} className="text-[var(--text-secondary)] text-sm mt-8">
        {t('biz.login.noAccount')}
      </button>
    </div>
  )
}
