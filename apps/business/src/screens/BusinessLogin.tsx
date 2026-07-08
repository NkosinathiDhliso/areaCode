import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { classifyLoginError } from '@area-code/shared/lib/loginError'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startBusinessGoogleOAuthWeb, startManagerGoogleOAuthWeb } from '../lib/businessHostedUiOAuth'

interface BusinessLoginProps {
  onSwitchToSignup: () => void
}

export function BusinessLogin({ onSwitchToSignup }: BusinessLoginProps) {
  const { t } = useTranslation()
  const setAuth = useBusinessAuthStore((s) => s.setAuth)
  const setRole = useBusinessAuthStore((s) => s.setRole)
  const [mode, setMode] = useState<'owner' | 'manager'>('owner')
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
      if (mode === 'manager') {
        // Managers authenticate against the staff Cognito pool, then operate
        // the business dashboard. Store the staff session and select the staff
        // refresh path; the dashboard fetches the manager role + permissions.
        const res = await api.post<{
          accessToken: string
          refreshToken: string
          staff: { id: string; name: string; businessId: string }
        }>('/v1/auth/staff/email-login', { email, password })
        api.setRefreshPath('/v1/auth/staff/refresh')
        setAuth(res.accessToken, res.refreshToken, res.staff.businessId)
        setRole('manager', [])
        return
      }
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        businessId: string
      }>('/v1/auth/business/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.businessId)
    } catch (err: unknown) {
      const { kind, message } = classifyLoginError(err)
      if (kind === 'rate-limited') {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
      } else if (kind === 'server') {
        setError(t('auth.login.serverError', 'Something went wrong on our side. Please try again.'))
      } else if (kind === 'unconfirmed') {
        setError(message ?? t('auth.login.verifyEmail', 'Please verify your email before signing in.'))
      } else if (kind === 'reset-required') {
        setError(message ?? t('auth.login.resetRequired', 'Please reset your password to continue.'))
      } else {
        setError(t('biz.login.emailFailed', 'Invalid email or password.'))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    setShowEnvHint(false)
    try {
      if (mode === 'manager') {
        await startManagerGoogleOAuthWeb()
      } else {
        await startBusinessGoogleOAuthWeb()
      }
    } catch {
      setGoogleLoading(false)
      setError(t('auth.oauth.misconfigured', 'Google sign-in is not configured for this deployment.'))
      setShowEnvHint(true)
    }
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">
        {mode === 'manager' ? t('biz.login.managerTitle', 'Manager sign in') : t('biz.login.title')}
      </h1>

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

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'owner' ? 'manager' : 'owner')
          setError(null)
          setShowEnvHint(false)
        }}
        className="text-[var(--text-secondary)] text-sm mt-6"
      >
        {mode === 'owner'
          ? t('biz.login.managerPrompt', 'Invited as a manager? Sign in here')
          : t('biz.login.ownerPrompt', 'Business owner? Sign in here')}
      </button>

      {mode === 'owner' && (
        <button type="button" onClick={onSwitchToSignup} className="text-[var(--text-secondary)] text-sm mt-3">
          {t('biz.login.noAccount')}
        </button>
      )}
    </div>
  )
}
