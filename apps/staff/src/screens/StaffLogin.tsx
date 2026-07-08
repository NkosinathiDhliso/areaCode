import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { classifyLoginError } from '@area-code/shared/lib/loginError'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startStaffGoogleOAuthWeb } from '../lib/startStaffGoogleOAuth'
import { useStaffAuthStore } from '../stores/staffAuthStore'

export function StaffLogin() {
  const { t } = useTranslation()
  const setAuth = useStaffAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    try {
      await startStaffGoogleOAuthWeb()
    } catch {
      setGoogleLoading(false)
      setError(t('auth.oauth.misconfigured', 'Google sign-in is not configured for this deployment.'))
    }
  }

  async function handleEmailLogin() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        staff: { id: string; name: string; businessId: string }
      }>('/v1/auth/staff/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.staff.id, res.staff.businessId, res.staff.name)
    } catch (err: unknown) {
      const { kind, message } = classifyLoginError(err)
      if (kind === 'rate-limited') {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
        return
      }
      if (kind === 'server') {
        setError(t('auth.login.serverError', 'Something went wrong on our side. Please try again.'))
        return
      }
      if (kind === 'unconfirmed') {
        setError(message ?? t('auth.login.verifyEmail', 'Please verify your email before signing in.'))
        return
      }
      if (kind === 'reset-required') {
        setError(message ?? t('auth.login.resetRequired', 'Please reset your password to continue.'))
        return
      }
      setError(t('staff.login.emailFailed', 'Invalid email or password.'))
    } finally {
      setLoading(false)
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
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">{t('staff.login.title')}</h1>

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
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-[var(--text-muted)] text-xs">{t('auth.login.or', 'or')}</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('staff.login.email', 'Email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('staff.login.password', 'Password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleEmailLogin()}
          disabled={loading || !email || !password}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('staff.login.submitEmail', 'Sign in')
          )}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}
    </div>
  )
}
