import { api } from '@area-code/shared/lib/api'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { BusinessReceipt, ReceiptWindowName } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { PANEL_BY_ONBOARDING_STEP } from './OnboardingChecklistCard'

/* ------------------------------------------------------------------ */
/*  The Receipt above the upgrade CTA (proof-of-demand R6.2, R6.3).    */
/*                                                                     */
/*  How many people found the venue on Area Code and checked in during  */
/*  the window the owner is deciding about, next to the button that     */
/*  keeps the numbers running.                                          */
/*                                                                     */
/*  Two rules this card must never break:                               */
/*   - It sits ABOVE the plan cards and never gates them. Loading and   */
/*     a failed read are states of this card only; the upgrade CTA is    */
/*     rendered by PlansPanel regardless, so a receipt outage can never  */
/*     stop someone paying.                                             */
/*   - Every sentence is rendered verbatim from the API. The Found_You   */
/*     fact has one wording (`buildReceiptCopy`), and the zero state is  */
/*     the server's next step, not a number, so a quiet window reads as  */
/*     "print the QR" rather than "0 people found you".                  */
/* ------------------------------------------------------------------ */

interface PlansReceiptCardProps {
  /** Which decision window to report. Resolved from the subscription server-side. */
  receiptWindow: ReceiptWindowName
}

const CARD_CLASS = 'bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-2'

export function PlansReceiptCard({ receiptWindow }: PlansReceiptCardProps) {
  const { t } = useTranslation()
  const setPanel = useBusinessStore((s) => s.setPanel)

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['business', 'receipt', receiptWindow],
    queryFn: () => api.get<BusinessReceipt>(`/v1/business/receipt?window=${receiptWindow}`),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div data-testid="plans-receipt-loading" className={CARD_CLASS}>
        <div className="h-4 w-56 bg-[var(--bg-raised)] rounded-lg animate-pulse" />
        <div className="h-4 w-40 bg-[var(--bg-raised)] rounded-lg animate-pulse" />
      </div>
    )
  }

  // No silent failure: the owner is told the numbers could not be read, with a
  // retry. The plan cards below are untouched.
  if (error || !data) {
    return (
      <div data-testid="plans-receipt-error" className={CARD_CLASS}>
        <span className="text-[var(--danger)] text-sm">
          {t('biz.receipt.error', "Couldn't load your check-in numbers. Your plan options below still work.")}
        </span>
        <button
          type="button"
          data-testid="plans-receipt-retry"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="self-start min-h-11 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold active:scale-95 transition-transform duration-150 disabled:opacity-60"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    )
  }

  const nextStepPanel = data.nextStep?.step ? PANEL_BY_ONBOARDING_STEP[data.nextStep.step] : null

  return (
    <div data-testid="plans-receipt" className={CARD_CLASS}>
      <p data-testid="plans-receipt-headline" className="text-[var(--text-primary)] text-sm font-medium">
        {data.headline}
      </p>
      <p data-testid="plans-receipt-walkin" className="text-[var(--text-secondary)] text-sm">
        {data.walkIn}
      </p>
      {data.firstTimers && (
        <p data-testid="plans-receipt-firsttimers" className="text-[var(--text-secondary)] text-sm">
          {data.firstTimers}
        </p>
      )}
      {data.bySource && (
        <p data-testid="plans-receipt-bysource" className="text-[var(--text-muted)] text-xs">
          {data.bySource}
        </p>
      )}
      {data.measuredFrom && (
        <p data-testid="plans-receipt-measuredfrom" className="text-[var(--text-muted)] text-xs">
          {data.measuredFrom}
        </p>
      )}

      {/* Zero Found_You: one constructive step, from the server's checklist
          reading, deep-linked to the panel that completes it (R6.3). */}
      {data.nextStep && (
        <div className="flex flex-col gap-2 mt-1">
          <p data-testid="plans-receipt-nextstep" className="text-[var(--text-primary)] text-sm">
            {data.nextStep.text}
          </p>
          {nextStepPanel && (
            <button
              type="button"
              data-testid="plans-receipt-nextstep-cta"
              data-panel={nextStepPanel}
              onClick={() => setPanel(nextStepPanel)}
              className="self-start min-h-11 px-5 rounded-xl border border-[var(--border-strong)] text-[var(--text-primary)] text-sm font-semibold active:scale-95 transition-transform duration-150"
            >
              {t('biz.receipt.nextStepCta', 'Finish this step')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
