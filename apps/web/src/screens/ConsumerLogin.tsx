import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { classifyLoginError } from '@area-code/shared/lib/loginError'
import { trackEvent } from '@area-code/shared/lib/usageEvents'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cleanFirstGetToken, redeemFirstGetToken } from '../lib/firstGetToken'
import { startConsumerGoogleOAuthWeb } from '../lib/startConsumerGoogleOAuth'
import type { AppRoute } from '../types'

interface ConsumerLoginProps {
  onNavigate: (route: AppRoute) => void
}

/** Tokens returned by both the email-login and email-signup endpoints. */
interface AuthTokens {
  accessToken: string
  refreshToken: string
  user: { id: string }
}

/**
 * The single consumer email/password auth screen.
 *
 * There is one entry: "Sign in". A returning user signs in; a new user has the
 * account created with the same credentials (the signup endpoint records POPIA
 * consent and sends the verification email, so nothing is bypassed). This is
 * why there is no separate signup screen - one home for one capability
 * (see `no-fallbacks-no-legacy.md` / `dry-reuse-no-duplication.md`).
 *
 * The optional First-Get token field lets a casual customer who was handed a
 * venue code redeem it as part of account creation. Google OAuth signups redeem
 * via `FirstGetPrompt` instead (no pre-auth field exists there); both share the
 * `firstGetToken` helper.
 */
export function ConsumerLogin({ onNavigate }: ConsumerLoginProps) {
  const { t } = useTranslation()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showTokenField, setShowTokenField] = useState(false)
  const [firstGetToken, setFirstGetToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = email.length > 0 && password.length > 0

  async function handleEmailAuth() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<AuthTokens>('/v1/auth/consumer/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.user.id)
      onNavigate('map')
    } catch (err) {
      const { kind, message } = classifyLoginError(err)
      switch (kind) {
        case 'rate-limited':
          setError(t('auth.login.tooManyAttempts', 'Too many attempts. Please try again in a few minutes.'))
          return
        case 'server':
          // The global toast already shows the reassuring server-error copy;
          // keep the inline message aligned instead of blaming the credentials.
          setError(t('auth.login.serverError', 'Something went wrong on our side. Please try again.'))
          return
        case 'unconfirmed':
          setError(message ?? t('auth.login.verifyEmail', 'Please verify your email before signing in.'))
          return
        case 'reset-required':
          setError(message ?? t('auth.login.resetRequired', 'Please reset your password to continue.'))
          return
        case 'credentials': {
          // Cognito answers the same 401 for a wrong password and an unknown
          // account. Treat sign-in as sign-up by creating the account with the
          // same credentials (a 409 back means the password was simply wrong).
          // A short password can never be a real account, so guide instead of
          // attempting an invalid signup.
          if (password.length < 8) {
            setError(t('auth.login.passwordShort', 'Password must be at least 8 characters'))
            return
          }
          await createAccountWithSameCredentials()
          return
        }
        default:
          // 400 / 404 / network: show clean, generic copy rather than leaking
          // raw backend status text, and never silently attempt a signup the
          // way the old catch-all fall-through did.
          setError(t('auth.login.emailFailed', 'Invalid email or password.'))
          return
      }
    } finally {
      setLoading(false)
    }
  }

  /**
   * Fall-through when an email/password sign-in fails: create the account with
   * the same credentials, then redeem any First-Get token. A 409 means the
   * email is already registered, so the original failure was a wrong password,
   * not a missing account.
   */
  async function createAccountWithSameCredentials() {
    // Signup funnel: account creation is genuinely starting (the sign-in failed
    // because no account exists). Beacon gates on consent (R4.1, R4.2).
    trackEvent('signup_started')
    let created: AuthTokens
    try {
      created = await api.post<AuthTokens>('/v1/auth/consumer/email-signup', { email, password })
    } catch (signupErr) {
      const signupStatus = (signupErr as { statusCode?: number } | null)?.statusCode
      if (signupStatus === 409) {
        setError(t('auth.login.emailFailed', 'Invalid email or password.'))
      } else if (signupStatus === 429) {
        setError(t('auth.login.tooManyAttempts', 'Too many attempts. Please try again in a few minutes.'))
      } else {
        setError(t('auth.signup.emailFailed', 'Could not create your account. Check your details.'))
      }
      return
    }

    setAuth(created.accessToken, created.refreshToken, created.user.id)
    // Signup funnel completion for the email/password path (R4.1).
    trackEvent('signup_completed', { method: 'email' })

    // Redeem an optional First-Get token. Failure is non-fatal: the account is
    // ready either way, so surface a soft notice and still land on the map.
    const token = cleanFirstGetToken(firstGetToken)
    if (token.length > 0) {
      try {
        await redeemFirstGetToken(token)
      } catch {
        setError(t('auth.signup.tokenInvalid', "Couldn't apply that code, but your account is ready."))
      }
    }

    onNavigate('map')
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
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-2 font-[Syne]">{t('auth.login.title')}</h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8 text-center max-w-xs">
        {t('auth.login.subtitle', "New here? Just sign in and we'll set up your account.")}
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
            t('auth.login.continueGoogle', 'Continue with Google')
          )}
        </button>
        <p className="text-center text-[var(--text-muted)] text-xs">or use email and password</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && !googleLoading && canSubmit && void handleEmailAuth()}
          placeholder={t('auth.login.email', 'Email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && !googleLoading && canSubmit && void handleEmailAuth()}
          placeholder={t('auth.login.password', 'Password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        {password.length > 0 && password.length < 8 && (
          <p className="text-[var(--warning)] text-xs -mt-2">
            {t('auth.login.passwordShort', 'Password must be at least 8 characters')}
          </p>
        )}
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
            onChange={(e) => setFirstGetToken(cleanFirstGetToken(e.target.value))}
            maxLength={8}
            placeholder={t('auth.signup.tokenPlaceholder', 'First-Get code (8 chars)')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none uppercase tracking-[0.3em]"
          />
        )}
        <button
          type="button"
          onClick={() => void handleEmailAuth()}
          disabled={loading || googleLoading || !canSubmit}
          className="bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('auth.login.submitEmail', 'Sign in')
          )}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-4 text-center">{error}</p>}

      <button
        type="button"
        onClick={() => onNavigate('forgot-password')}
        className="mt-4 text-[var(--text-muted)] text-sm"
      >
        {t('auth.login.forgotPassword', 'Forgot password?')}
      </button>
      <button type="button" onClick={() => onNavigate('map')} className="mt-3 text-[var(--text-muted)] text-xs">
        {t('auth.login.browseOnly')}
      </button>
    </div>
  )
}
