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
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5 py-10">
      {/* Brand + value prop */}
      <div className="w-full max-w-xs mb-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/20 ring-1 ring-[var(--border)]">
            <div className="h-2 w-2 rounded-full bg-[var(--accent-bright)] animate-pulse" />
          </div>
          <span className="font-[Syne] text-lg font-extrabold tracking-tight text-[var(--text-primary)]">
            Area Code <span className="text-[var(--text-secondary)] font-semibold">· Business</span>
          </span>
        </div>
        <h1 className="text-[var(--text-primary)] font-bold text-2xl font-[Syne] leading-tight">
          {t('biz.login.title', 'Your venue, in real time')}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          {t(
            'biz.login.subtitle',
            'The owner portal. Track foot traffic, publish offers, and grow loyalty with verified locals.',
          )}
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-xs text-[var(--text-secondary)]">
          {[
            t('biz.login.benefit1', 'See live crowd vibe and check-ins as they happen'),
            t('biz.login.benefit2', 'Publish Gets (rewards) and Boost your visibility'),
            t('biz.login.benefit3', 'Verify check-ins and reach customers nearby'),
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
