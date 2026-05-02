import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
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
  const [error, setError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleEmailLogin() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        sessionId?: string
        staff: { id: string; name: string; businessId: string }
      }>('/v1/auth/staff/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.staff.id, res.staff.businessId, res.staff.name, res.sessionId)
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number } | undefined
      if (apiErr?.statusCode === 429) {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
        return
      }
      setError(t('staff.login.emailFailed', 'Invalid email or password.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    try {
      await startStaffGoogleOAuthWeb()
    } catch {
      setGoogleLoading(false)
      setError(t('auth.oauth.misconfigured', 'Sign-in is not configured. Try again later.'))
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">{t('staff.login.title')}</h1>

      <div className="flex flex-col gap-4 w-full max-w-xs mb-6">
        <button
          type="button"
          onClick={() => void handleGoogle()}
          disabled={googleLoading}
          className="flex items-center justify-center gap-3 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
        >
          {googleLoading ? (
            <Spinner size="sm" className="border-[var(--accent)] border-t-transparent" />
          ) : (
            t('auth.login.continueGoogle', 'Continue with Google')
          )}
        </button>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <p className="text-center text-[var(--text-muted)] text-xs">or use email and password</p>
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
          disabled={loading || googleLoading || !email || !password}
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
