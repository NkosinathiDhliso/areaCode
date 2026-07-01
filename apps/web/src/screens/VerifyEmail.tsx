import { api } from '@area-code/shared/lib/api'
import { Spinner } from '@area-code/shared/components/Spinner'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppRoute } from '../types'

interface VerifyEmailProps {
  onNavigate: (route: AppRoute) => void
}

type Status = 'verifying' | 'success' | 'error'

export function VerifyEmail({ onNavigate }: VerifyEmailProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>('verifying')

  useEffect(() => {
    let cancelled = false
    async function run() {
      const token = new URLSearchParams(window.location.search).get('token')
      if (!token) {
        if (!cancelled) setStatus('error')
        return
      }
      try {
        await api.post('/v1/auth/consumer/verify-email', { token })
        if (!cancelled) setStatus('success')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  function go() {
    window.history.replaceState({}, '', '/map')
    onNavigate('map')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5 text-center">
      {status === 'verifying' && (
        <>
          <h1 className="text-[var(--text-primary)] font-bold text-xl mb-6 font-[Syne]">
            {t('auth.verifyEmail.checking', 'Confirming your email…')}
          </h1>
          <Spinner size="lg" />
        </>
      )}

      {status === 'success' && (
        <>
          <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-3 font-[Syne]">
            {t('auth.verifyEmail.successTitle', 'Email confirmed')}
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mb-8 max-w-xs">
            {t('auth.verifyEmail.successBody', "You're all set. Your account is fully verified.")}
          </p>
          <button
            type="button"
            onClick={go}
            className="bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-3.5 px-8 text-base transition-all duration-150 active:scale-95"
          >
            {t('auth.verifyEmail.continue', 'Continue')}
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-3 font-[Syne]">
            {t('auth.verifyEmail.errorTitle', 'Link expired or invalid')}
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mb-8 max-w-xs">
            {t(
              'auth.verifyEmail.errorBody',
              'This verification link is no longer valid. You can request a new one from your profile.',
            )}
          </p>
          <button
            type="button"
            onClick={go}
            className="bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-3.5 px-8 text-base transition-all duration-150 active:scale-95"
          >
            {t('auth.verifyEmail.continue', 'Continue')}
          </button>
        </>
      )}
    </div>
  )
}
