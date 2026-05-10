/**
 * Pre-payment confirmation summary shown before Yoco redirect.
 * Displays item description, amount in ZAR, billing frequency, and "Confirm & Pay" button.
 *
 * Requirements: 28.1
 */
import { useTranslation } from 'react-i18next'

import { Button } from './Button'
import { Card } from './Card'

export interface PaymentConfirmationProps {
  /** Description of the item being purchased */
  description: string
  /** Amount in ZAR cents */
  amountCents: number
  /** Billing frequency label (e.g., "Monthly", "Daily", "Once-off") */
  frequency: string
  /** Whether the confirm action is in progress */
  loading?: boolean
  /** Called when user confirms payment */
  onConfirm: () => void
  /** Called when user cancels */
  onCancel: () => void
}

function formatZARCents(cents: number): string {
  return (cents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })
}

export function PaymentConfirmation({
  description,
  amountCents,
  frequency,
  loading = false,
  onConfirm,
  onCancel,
}: PaymentConfirmationProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center gap-5 p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('payment.confirmTitle', 'Confirm Payment')}
      </h2>

      <Card className="w-full max-w-sm">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.item', 'Item')}
            </span>
            <span className="text-[var(--text-primary)] text-sm font-medium text-right max-w-[200px]">
              {description}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.amount', 'Amount')}
            </span>
            <span className="text-[var(--text-primary)] text-lg font-bold">
              {formatZARCents(amountCents)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.frequency', 'Billing')}
            </span>
            <span className="text-[var(--text-secondary)] text-sm">
              {frequency}
            </span>
          </div>

          <div className="border-t border-[var(--border)] pt-3 mt-1 text-center">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.redirectNotice', 'You will be redirected to Yoco to complete payment')}
            </span>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        <Button
          variant="primary"
          size="lg"
          loading={loading}
          onClick={onConfirm}
          aria-label={t('payment.confirmAndPay', 'Confirm & Pay')}
        >
          {t('payment.confirmAndPay', 'Confirm & Pay')}
        </Button>

        <Button
          variant="ghost"
          size="md"
          onClick={onCancel}
          disabled={loading}
          aria-label={t('common.cancel', 'Cancel')}
        >
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}
