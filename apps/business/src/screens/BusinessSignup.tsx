import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startBusinessGoogleOAuthWeb } from '../lib/businessHostedUiOAuth'

interface BusinessSignupProps {
  onSwitchToLogin: () => void
}

export function BusinessSignup({ onSwitchToLogin }: BusinessSignupProps) {
  const { t } = useTranslation()
  const setAuth = useBusinessAuthStore((s) => s.setAuth)
  const [businessName, setBusinessName] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEnvHint, setShowEnvHint] = useState(false)

  async function handleEmailSignup() {
    setLoading(true)
    setError(null)
    setShowEnvHint(false)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        businessId: string
      }>('/v1/auth/business/email-signup', {
        email,
        password,
        businessName,
        ...(registrationNumber ? { registrationNumber } : {}),
      })
      setAuth(res.accessToken, res.refreshToken, res.businessId)
    } catch {
      setError(t('biz.signup.emailFailed', 'Could not create your account. Check your details.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSignup() {
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

  const canSubmit = businessName.trim().length >= 2 && email.includes('@') && password.length >= 8

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-2 font-[Syne]">{t('biz.signup.title')}</h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8 text-center max-w-xs">{t('biz.signup.subtitle')}</p>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          type="button"
          onClick={() => void handleGoogleSignup()}
          disabled={googleLoading || loading}
          className="flex items-center justify-center gap-3 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
        >
          {googleLoading ? (
            <Spinner size="sm" className="border-[var(--accent)] border-t-transparent" />
          ) : (
            t('auth.login.continueGoogle', 'Continue with Google')
          )}
        </button>

        <p className="text-center text-[var(--text-muted)] text-xs">or create an email account</p>

        <input
          type="text"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder={t('biz.signup.businessName')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('biz.signup.email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('biz.signup.password', 'Password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="text"
          value={registrationNumber}
          onChange={(e) => setRegistrationNumber(e.target.value)}
          placeholder={`${t('biz.signup.regNumber')} (${t('common.optional', 'optional')})`}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleEmailSignup()}
          disabled={loading || googleLoading || !canSubmit}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('biz.signup.submitEmail', 'Create account')
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

      <button type="button" onClick={onSwitchToLogin} className="text-[var(--text-secondary)] text-sm mt-8">
        {t('biz.signup.hasAccount')}
      </button>
    </div>
  )
}
