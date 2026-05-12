import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startConsumerGoogleOAuthWeb } from '../lib/startConsumerGoogleOAuth'
import type { AppRoute } from '../types'

interface ConsumerLoginProps {
  onNavigate: (route: AppRoute) => void
}

export function ConsumerLogin({ onNavigate }: ConsumerLoginProps) {
  const { t } = useTranslation()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmailLogin() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        sessionId?: string
        user: { id: string }
      }>('/v1/auth/consumer/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.user.id, res.sessionId)
      onNavigate('map')
    } catch {
      setError(t('auth.login.emailFailed', 'Invalid email or password.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    try {
      await startConsumerGoogleOAuthWeb()
    } catch {
      setGoogleLoading(false)
      setError(t('auth.oauth.misconfigured', 'Google sign-in is not configured for this deployment.'))
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">{t('auth.login.title')}</h1>

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
          onKeyDown={(e) =>
            e.key === 'Enter' && !loading && !googleLoading && email && password && void handleEmailLogin()
          }
          placeholder={t('auth.login.email', 'Email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && !loading && !googleLoading && email && password && void handleEmailLogin()
          }
          placeholder={t('auth.login.password', 'Password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        {password.length > 0 && password.length < 8 && (
          <p className="text-[var(--warning)] text-xs -mt-2">
            {t('auth.login.passwordShort', 'Password must be at least 8 characters')}
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleEmailLogin()}
          disabled={loading || googleLoading || !email || !password}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('auth.login.submitEmail', 'Sign in')
          )}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-4 text-center">{error}</p>}

      <button type="button" onClick={() => onNavigate('forgot-password')} className="mt-4 text-[var(--text-muted)] text-sm">
        {t('auth.login.forgotPassword', 'Forgot password?')}
      </button>
      <button type="button" onClick={() => onNavigate('signup')} className="mt-3 text-[var(--accent)] text-sm">
        {t('auth.login.noAccount')}
      </button>
      <button type="button" onClick={() => onNavigate('map')} className="mt-3 text-[var(--text-muted)] text-xs">
        {t('auth.login.browseOnly')}
      </button>
    </div>
  )
}
