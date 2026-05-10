/**
 * Grace period banner for failed payments.
 * Persistent but dismissible banner shown when payment fails.
 *
 * Requirements: 28.5
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface GracePeriodBannerProps {
  /** Number of days remaining in grace period */
  daysRemaining: number
  /** Called when user taps retry payment */
  onRetryPayment: () => void
}

export function GracePeriodBanner({ daysRemaining, onRetryPayment }: GracePeriodBannerProps) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div
      className="bg-[var(--danger-soft)] border border-[var(--danger)] rounded-xl px-4 py-3 flex items-start gap-3"
      role="alert"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="flex-shrink-0 mt-0.5"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>

      <div className="flex-1 flex flex-col gap-1">
        <p className="text-[var(--text-primary)] text-sm font-medium">
          {t('payment.graceBannerTitle', 'Payment failed')}
        </p>
        <p className="text-[var(--text-secondary)] text-xs">
          {t('payment.graceBannerMsg', 'Update your payment method within {{days}} days to keep your plan active.', {
            days: daysRemaining,
          })}
        </p>
        <button
          onClick={onRetryPayment}
          className="text-[var(--accent)] text-xs font-medium mt-1 text-left"
        >
          {t('payment.retryPayment', 'Retry payment →')}
        </button>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="text-[var(--text-muted)] flex-shrink-0"
        aria-label={t('common.dismiss', 'Dismiss')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
