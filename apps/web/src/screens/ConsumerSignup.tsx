import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '@area-code/shared/components/Spinner'

import { startConsumerGoogleOAuthWeb } from '../lib/startConsumerGoogleOAuth'
import type { AppRoute } from '../types'

interface ConsumerSignupProps {
  onNavigate: (route: AppRoute) => void
}

export function ConsumerSignup({ onNavigate }: ConsumerSignupProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogle() {
    setLoading(true)
    setError(null)
    try {
      await startConsumerGoogleOAuthWeb()
    } catch {
      setLoading(false)
      setError(t('auth.oauth.misconfigured', 'Sign-in is not configured. Try again later.'))
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5 py-8">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-4 font-[Syne] text-center">
        {t('auth.signup.title')}
      </h1>
      <p className="text-[var(--text-secondary)] text-sm text-center mb-8 max-w-xs">
        {t(
          'auth.signup.googleExplainer',
          'Create your profile with Google. You can set your username and city after signing in.',
        )}
      </p>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          type="button"
          onClick={() => void handleGoogle()}
          disabled={loading}
          className="flex items-center justify-center gap-3 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
        >
          {loading ? (
            <Spinner size="sm" className="border-[var(--accent)] border-t-transparent" />
          ) : (
            t('auth.signup.continueGoogle', 'Continue with Google')
          )}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-4 text-center">{error}</p>}

      <p className="text-[var(--text-muted)] text-xs mt-8 text-center max-w-xs">
        {t('profile.privacyExplainer')}
      </p>

      <button type="button" onClick={() => onNavigate('login')} className="mt-6 text-[var(--accent)] text-sm">
        {t('auth.signup.hasAccount')}
      </button>
    </div>
  )
}
