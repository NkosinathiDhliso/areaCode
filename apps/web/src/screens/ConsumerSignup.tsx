import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startConsumerGoogleOAuthWeb } from '../lib/startConsumerGoogleOAuth'
import type { AppRoute } from '../types'

interface ConsumerSignupProps {
  onNavigate: (route: AppRoute) => void
}

export function ConsumerSignup({ onNavigate }: ConsumerSignupProps) {
  const { t } = useTranslation()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showTokenField, setShowTokenField] = useState(false)
  const [firstGetToken, setFirstGetToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * After a successful signup, redeem any First-Get token the user
   * entered. Failure is non-fatal — they still get an account.
   * Churn-defences spec, Requirement 6.
   */
  async function maybeRedeemFirstGetToken() {
    const token = firstGetToken.trim().toUpperCase()
    if (!token) return
    try {
      await api.post('/v1/users/me/redeem-guest-token', { token })
    } catch {
      // Surface a soft error so the user knows the token didn't apply,
      // but don't block them from using the app.
      setError(t('auth.signup.tokenInvalid', "Couldn't apply that code, but your account is ready."))
    }
  }

  async function handleEmailSignup() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        sessionId?: string
        user: { id: string }
      }>('/v1/auth/consumer/email-signup', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.user.id, res.sessionId)
      await maybeRedeemFirstGetToken()
      onNavigate('map')
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 409) {
        setError(t('auth.signup.errorEmailExists', 'That email is already registered. Try signing in instead.'))
      } else if (status === 429) {
        setError(t('auth.signup.errorRateLimit', 'Too many attempts. Please wait a few minutes and try again.'))
      } else if (status === 400) {
        setError(t('auth.signup.errorInvalid', 'Please check your email and a password of at least 8 characters.'))
      } else {
        setError(t('auth.signup.emailFailed', 'Could not create your account. Please try again.'))
      }
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
    <div
      className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-4 font-[Syne] text-center">
        {t('auth.signup.title')}
      </h1>
      <p className="text-[var(--text-secondary)] text-sm text-center mb-8 max-w-xs">
        {t(
          'auth.signup.googleExplainer',
          'Create your profile with Google or email. You can update your profile after signing in.',
        )}
      </p>

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
            t('auth.signup.continueGoogle', 'Continue with Google')
          )}
        </button>
        <p className="text-center text-[var(--text-muted)] text-xs">or create an email account</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && !loading && !googleLoading && email && password.length >= 8 && void handleEmailSignup()
          }
          placeholder={t('auth.signup.email', 'Email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && !loading && !googleLoading && email && password.length >= 8 && void handleEmailSignup()
          }
          placeholder={t('auth.signup.password', 'Password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <p
          className={`text-xs -mt-2 ${password.length > 0 && password.length < 8 ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`}
        >
          {password.length > 0 && password.length < 8
            ? t('auth.signup.passwordTooShort', 'Password must be at least 8 characters')
            : t('auth.signup.passwordHint', 'Minimum 8 characters')}
        </p>
        {!showTokenField && (
          <button
            type="button"
            onClick={() => setShowTokenField(true)}
            className="text-[var(--text-muted)] text-xs underline self-center"
          >
            {t('auth.signup.haveToken', 'Got a code from a venue?')}
          </button>
        )}
        {showTokenField && (
          <input
            type="text"
            value={firstGetToken}
            onChange={(e) => setFirstGetToken(e.target.value.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, ''))}
            maxLength={8}
            placeholder={t('auth.signup.tokenPlaceholder', 'First-Get code (8 chars)')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none uppercase tracking-[0.3em]"
          />
        )}
        <button
          type="button"
          onClick={() => void handleEmailSignup()}
          disabled={loading || googleLoading || !email || password.length < 8}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('auth.signup.submitEmail', 'Create account')
          )}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-4 text-center">{error}</p>}

      <p className="text-[var(--text-muted)] text-xs mt-8 text-center max-w-xs">{t('profile.privacyExplainer')}</p>

      <button type="button" onClick={() => onNavigate('login')} className="mt-6 text-[var(--accent)] text-sm">
        {t('auth.signup.hasAccount')}
      </button>
    </div>
  )
}
