import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type SendState = 'idle' | 'sending' | 'sent' | 'error'

/**
 * Soft, dismissible prompt nudging email-signup users to confirm their address.
 * Non-blocking by design (see the non-blocking verification decision): it only
 * appears when the signed-in user's `emailVerified` flag is explicitly false,
 * and never gates app usage. Reads the shared user store (populated once on app
 * load) so it adds no extra fetch. Feedback is shown inline rather than through
 * the domain Toast system, which is reserved for live venue signals.
 */
export function VerifyEmailBanner() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const [state, setState] = useState<SendState>('idle')
  const [dismissed, setDismissed] = useState(false)

  // Only show for users we know are unverified. `undefined` (older sessions,
  // OAuth users, dev) means "don't nag".
  if (dismissed || !user || user.emailVerified !== false) return null

  async function resend() {
    setState('sending')
    try {
      const res = await api.post<{ sent: boolean; alreadyVerified?: boolean }>('/v1/auth/consumer/resend-verification')
      setState('sent')
      if (res.alreadyVerified) setDismissed(true)
    } catch {
      setState('error')
    }
  }

  const message =
    state === 'sent'
      ? t('auth.verifyBanner.sent', 'Verification email sent. Check your inbox.')
      : state === 'error'
        ? t('auth.verifyBanner.failed', "Couldn't send right now. Try again later.")
        : t('auth.verifyBanner.message', 'Confirm your email to secure your account and unlock everything.')

  return (
    <div
      role="status"
      className="flex items-center gap-3 bg-[var(--bg-raised)] border-b border-[var(--border)] px-4 py-2.5 text-sm"
    >
      <span className="flex-1 text-[var(--text-secondary)]">{message}</span>
      {state !== 'sent' && (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state === 'sending'}
          className="shrink-0 text-[var(--accent)] font-semibold disabled:opacity-50 flex items-center gap-1.5"
        >
          {state === 'sending' ? <Spinner size="sm" /> : t('auth.verifyBanner.resend', 'Resend')}
        </button>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('common.dismiss', 'Dismiss')}
        className="shrink-0 text-[var(--text-muted)] px-1"
      >
        ✕
      </button>
    </div>
  )
}
