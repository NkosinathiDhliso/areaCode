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
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5 py-10">
      {/* Brand + value prop */}
      <div className="w-full max-w-xs mb-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/20 ring-1 ring-[var(--border)]">
            <div className="h-2 w-2 rounded-full bg-[var(--accent-bright)] animate-pulse" />
          </div>
          <span className="font-[Syne] text-lg font-extrabold tracking-tight text-[var(--text-primary)]">
            Area Code
          </span>
        </div>
        <h1 className="text-[var(--text-primary)] font-bold text-2xl font-[Syne] leading-tight">
          {t('auth.login.title', 'Welcome back')}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          {t('auth.login.subtitle', 'Sign in to see what’s alive in your city right now.')}
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-xs text-[var(--text-secondary)]">
          {[
            t('auth.login.benefit1', 'Live crowd vibes at venues near you'),
            t('auth.login.benefit2', 'Earn Gets (rewards) every time you check in'),
            t('auth.login.benefit3', 'Climb the Ranks among locals in your city'),
          ].map((b) => (
            <li key={b} className="flex items-start gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--accent)] mt-0.5 shrink-0"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

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

      <button type="button" onClick={() => onNavigate('signup')} className="mt-8 text-[var(--accent)] text-sm">
        {t('auth.login.noAccount')}
      </button>
      <button type="button" onClick={() => onNavigate('map')} className="mt-3 text-[var(--text-muted)] text-xs">
        {t('auth.login.browseOnly')}
      </button>
    </div>
  )
}
