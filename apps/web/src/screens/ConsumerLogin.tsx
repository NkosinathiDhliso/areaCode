import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '@area-code/shared/components/Spinner'

import { startConsumerGoogleOAuthWeb } from '../lib/startConsumerGoogleOAuth'
import type { AppRoute } from '../types'

interface ConsumerLoginProps {
  onNavigate: (route: AppRoute) => void
}

export function ConsumerLogin({ onNavigate }: ConsumerLoginProps) {
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
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">
        {t('auth.login.title')}
      </h1>

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
            t('auth.login.continueGoogle', 'Continue with Google')
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
