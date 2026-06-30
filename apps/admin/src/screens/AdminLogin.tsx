import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import type { AdminRole } from '@area-code/shared/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startAdminGoogleOAuthWeb } from '../lib/startAdminGoogleOAuth'
import { useAdminAuthStore } from '../stores/adminAuthStore'

type LoginResponse =
  | { accessToken: string; refreshToken: string; adminId: string; role: AdminRole }
  | {
      mfaRequired: true
      challenge: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP'
      session: string
      email: string
      secretCode?: string
      otpauthUri?: string
    }

type Phase = 'credentials' | 'challenge' | 'setup'

export function AdminLogin() {
  const { t } = useTranslation()
  const setAuth = useAdminAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('credentials')
  const [session, setSession] = useState('')
  const [code, setCode] = useState('')
  const [secretCode, setSecretCode] = useState<string | null>(null)
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    try {
      await startAdminGoogleOAuthWeb()
    } catch {
      setGoogleLoading(false)
      setError(t('auth.oauth.misconfigured', 'Google sign-in is not configured for this deployment.'))
    }
  }

  function persist(res: Extract<LoginResponse, { accessToken: string }>) {
    setAuth(res.accessToken, res.refreshToken, res.adminId, res.role)
  }

  async function handleLogin() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<LoginResponse>('/v1/auth/admin/login', { email, password })
      if ('mfaRequired' in res) {
        setSession(res.session)
        if (res.challenge === 'MFA_SETUP') {
          setSecretCode(res.secretCode ?? null)
          setOtpauthUri(res.otpauthUri ?? null)
          setPhase('setup')
        } else {
          setPhase('challenge')
        }
        return
      }
      persist(res)
    } catch {
      setError(t('admin.login.invalid', 'Invalid credentials.'))
    } finally {
      setLoading(false)
    }
  }

  async function submitCode() {
    if (!/^\d{6}$/.test(code)) {
      setError(t('admin.login.codeFormat', 'Enter the 6-digit code from your authenticator app.'))
      return
    }
    setLoading(true)
    setError(null)
    const path = phase === 'setup' ? '/v1/auth/admin/mfa/complete-setup' : '/v1/auth/admin/mfa/respond'
    try {
      const res = await api.post<Extract<LoginResponse, { accessToken: string }>>(path, {
        email: email.toLowerCase().trim(),
        session,
        code,
      })
      persist(res)
    } catch {
      setError(t('admin.login.codeWrong', 'That code was incorrect or expired. Try again.'))
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none'
  const buttonClass =
    'bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2'

  return (
    <div
      className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">{t('admin.login.title')}</h1>

      {phase === 'credentials' && (
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
          <label className="sr-only" htmlFor="admin-email">
            {t('admin.login.email')}
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            placeholder={t('admin.login.email')}
            className={inputClass}
          />
          <label className="sr-only" htmlFor="admin-password">
            {t('admin.login.password')}
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            placeholder={t('admin.login.password')}
            className={inputClass}
          />
          <button onClick={() => void handleLogin()} disabled={loading || !email || !password} className={buttonClass}>
            {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('admin.login.submit')}
          </button>
        </div>
      )}

      {(phase === 'challenge' || phase === 'setup') && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          {phase === 'setup' && (
            <div className="text-[var(--text-secondary)] text-sm flex flex-col gap-3">
              <p>
                {t(
                  'admin.login.mfaSetupIntro',
                  'Set up two-factor authentication. Add this account to an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.',
                )}
              </p>
              {secretCode && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[var(--text-muted)]">
                    {t('admin.login.mfaSecretLabel', 'Setup key (enter manually if needed)')}
                  </span>
                  <code className="break-all bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-xs tracking-wider">
                    {secretCode}
                  </code>
                </div>
              )}
              {otpauthUri && (
                <a href={otpauthUri} className="text-[var(--accent)] text-xs underline">
                  {t('admin.login.mfaOpenApp', 'Open in authenticator app')}
                </a>
              )}
            </div>
          )}
          {phase === 'challenge' && (
            <p className="text-[var(--text-secondary)] text-sm">
              {t('admin.login.mfaPrompt', 'Enter the 6-digit code from your authenticator app.')}
            </p>
          )}
          <label className="sr-only" htmlFor="admin-mfa-code">
            {t('admin.login.mfaCodeLabel', 'Authentication code')}
          </label>
          <input
            id="admin-mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && void submitCode()}
            placeholder="000000"
            className={`${inputClass} text-center tracking-[0.5em] text-lg`}
          />
          <button onClick={() => void submitCode()} disabled={loading || code.length !== 6} className={buttonClass}>
            {loading ? (
              <Spinner size="sm" className="border-white border-t-transparent" />
            ) : (
              t('admin.login.mfaSubmit', 'Verify')
            )}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--danger)] mt-3">
          {error}
        </p>
      )}
    </div>
  )
}
