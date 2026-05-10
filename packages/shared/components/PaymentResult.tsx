/**
 * Post-payment return states: success (green), pending (amber), failed (red).
 * Shown after returning from Yoco payment redirect.
 *
 * Requirements: 28.2
 */
import { useTranslation } from 'react-i18next'

import { Button } from './Button'

export type PaymentResultStatus = 'success' | 'pending' | 'failed'

export interface PaymentResultProps {
  /** Payment outcome status */
  status: PaymentResultStatus
  /** Details about what was purchased (plan name or boost info) */
  details?: string
  /** Failure reason (when status is 'failed') */
  failureReason?: string
  /** Called when user taps "Try again" on failure */
  onRetry?: () => void
  /** Called when user taps "Continue" or "Done" */
  onContinue?: () => void
}

const statusConfig: Record<PaymentResultStatus, {
  bgClass: string
  iconColor: string
  icon: 'check' | 'clock' | 'x'
}> = {
  success: { bgClass: 'bg-[var(--success)]', iconColor: 'text-white', icon: 'check' },
  pending: { bgClass: 'bg-[var(--warning)]', iconColor: 'text-white', icon: 'clock' },
  failed: { bgClass: 'bg-[var(--danger)]', iconColor: 'text-white', icon: 'x' },
}

function StatusIcon({ icon }: { icon: 'check' | 'clock' | 'x' }) {
  switch (icon) {
    case 'check':
      return (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'clock':
      return (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )
    case 'x':
      return (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )
  }
}

export function PaymentResult({
  status,
  details,
  failureReason,
  onRetry,
  onContinue,
}: PaymentResultProps) {
  const { t } = useTranslation()
  const config = statusConfig[status]

  const titles: Record<PaymentResultStatus, string> = {
    success: t('payment.success', 'Payment Successful'),
    pending: t('payment.pending', 'Payment Processing'),
    failed: t('payment.failed', 'Payment Failed'),
  }

  const messages: Record<PaymentResultStatus, string> = {
    success: t('payment.successMsg', 'Your plan is now active'),
    pending: t('payment.pendingMsg', "We're processing your payment. We'll update you shortly."),
    failed: failureReason ?? t('payment.failedMsg', 'Something went wrong with your payment'),
  }

  return (
    <div className="flex flex-col items-center gap-5 p-5">
      <div className={`${config.bgClass} rounded-2xl p-8 flex flex-col items-center gap-4 w-full max-w-sm`}>
        <span className={config.iconColor}>
          <StatusIcon icon={config.icon} />
        </span>
        <h2 className="text-white font-bold text-xl font-[Syne] text-center">
          {titles[status]}
        </h2>
        <p className="text-white text-sm opacity-90 text-center">
          {messages[status]}
        </p>
        {details && (
          <p className="text-white text-xs opacity-75 text-center">{details}</p>
        )}
      </div>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        {status === 'failed' && onRetry && (
          <Button variant="primary" size="lg" onClick={onRetry}>
            {t('payment.tryAgain', 'Try Again')}
          </Button>
        )}
        {onContinue && (
          <Button
            variant={status === 'failed' ? 'ghost' : 'primary'}
            size="lg"
            onClick={onContinue}
          >
            {t('common.continue', 'Continue')}
          </Button>
        )}
      </div>
    </div>
  )
}
