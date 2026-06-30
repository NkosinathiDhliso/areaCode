/**
 * One-time post-signup prompt asking for a venue First-Get token.
 *
 * Routed to from `ConsumerOAuthCallback` when `isNewUser === true`.
 * Shown once per signup, dismissable. If the user enters a valid token,
 * we credit one historical visit and continue to the map.
 *
 * Defends against §1.6 of `docs/CHURN_DEFENSES.md` (members vs casuals)
 * for the Google-OAuth signup branch.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '@area-code/shared/components/Spinner'

import { cleanFirstGetToken, isCompleteFirstGetToken, redeemFirstGetToken } from '../lib/firstGetToken'
import type { AppRoute } from '../types'

interface FirstGetPromptProps {
  onNavigate: (route: AppRoute) => void
}

export function FirstGetPrompt({ onNavigate }: FirstGetPromptProps) {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!isCompleteFirstGetToken(token)) {
      setError(t('auth.firstGet.tokenInvalid', 'Codes are exactly 8 characters.'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      await redeemFirstGetToken(token)
      onNavigate('map')
    } catch {
      setError(t('auth.firstGet.tokenInvalid', "Couldn't apply that code. Check it with the venue or skip for now."))
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
      <div className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-[var(--text-primary)] font-bold text-xl text-center font-[Syne]">
          {t('auth.firstGet.title', 'Got a code from a venue?')}
        </h1>
        <p className="text-[var(--text-secondary)] text-sm text-center">
          {t(
            'auth.firstGet.subtitle',
            'If a venue gave you a one-time code at the till, enter it here. Otherwise, skip. You can still use the app normally.',
          )}
        </p>

        <input
          type="text"
          value={token}
          onChange={(e) => setToken(cleanFirstGetToken(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && !loading && void handleSubmit()}
          maxLength={8}
          placeholder="ABCD1234"
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-4 text-center text-lg font-mono tracking-[0.4em] uppercase placeholder:text-[var(--text-muted)] placeholder:tracking-[0.2em] focus:border-[var(--accent)] focus:outline-none"
          autoFocus
        />

        <button
          onClick={() => void handleSubmit()}
          disabled={loading || token.length !== 8}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('auth.firstGet.submit', 'Apply code')
          )}
        </button>

        <button onClick={() => onNavigate('map')} className="text-[var(--text-muted)] text-sm py-2">
          {t('auth.firstGet.skip', "Skip | I don't have a code")}
        </button>

        {error && <p className="text-[var(--danger)] text-xs text-center">{error}</p>}
      </div>
    </div>
  )
}
