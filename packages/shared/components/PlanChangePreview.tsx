/**
 * Plan change preview showing new plan, new amount, effective date, and prorating info.
 *
 * Requirements: 28.4
 */
import { useTranslation } from 'react-i18next'

import { Button } from './Button'
import { Card } from './Card'

export interface PlanChangePreviewProps {
  currentPlan: string
  newPlan: string
  newAmountCents: number
  effectiveDate: string
  proratingInfo?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function formatZARCents(cents: number): string {
  return (cents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })
}

export function PlanChangePreview({
  currentPlan,
  newPlan,
  newAmountCents,
  effectiveDate,
  proratingInfo,
  loading = false,
  onConfirm,
  onCancel,
}: PlanChangePreviewProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center gap-5 p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('payment.planChange', 'Change Plan')}
      </h2>

      <Card className="w-full max-w-sm">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.currentPlan', 'Current Plan')}
            </span>
            <span className="text-[var(--text-secondary)] text-sm">{currentPlan}</span>
          </div>

          <div className="flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.newPlan', 'New Plan')}
            </span>
            <span className="text-[var(--text-primary)] text-sm font-semibold">{newPlan}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.newAmount', 'New Amount')}
            </span>
            <span className="text-[var(--text-primary)] text-lg font-bold">
              {formatZARCents(newAmountCents)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)] text-xs">
              {t('payment.effectiveDate', 'Effective Date')}
            </span>
            <span className="text-[var(--text-secondary)] text-sm">
              {new Date(effectiveDate).toLocaleDateString('en-ZA', {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
            </span>
          </div>

          {proratingInfo && (
            <div className="border-t border-[var(--border)] pt-3 mt-1">
              <span className="text-[var(--text-muted)] text-xs">{proratingInfo}</span>
            </div>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        <Button variant="primary" size="lg" loading={loading} onClick={onConfirm}>
          {t('payment.confirmChange', 'Confirm Change')}
        </Button>
        <Button variant="ghost" size="md" onClick={onCancel} disabled={loading}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}
