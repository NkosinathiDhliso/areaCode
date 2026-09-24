import { api } from '@area-code/shared/lib/api'
import { useBusinessStore, type DashboardPanel } from '@area-code/shared/stores/businessStore'
import type { OnboardingChecklistStep, OnboardingStatus } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

/* ------------------------------------------------------------------ */
/*  Onboarding_Checklist card (proof-of-demand R5.1, R5.2).            */
/*                                                                     */
/*  Four rows, one per flag of GET /v1/business/me/onboarding-status,   */
/*  each deep-linking to the panel that completes it. The card is the   */
/*  first thing on the dashboard while any flag is false and renders    */
/*  nothing once all four are true.                                     */
/*                                                                     */
/*  This module owns the step-to-panel mapping. `buildReceiptCopy`      */
/*  returns `ReceiptNextStep.step` as an `OnboardingChecklistStep` for  */
/*  exactly this reason: the copy builder never knows about portal      */
/*  navigation, and the mapping lives in one place that the Plans panel */
/*  receipt can import rather than restate.                             */
/* ------------------------------------------------------------------ */

/** The panel that completes each checklist step. One home for the deep links. */
export const PANEL_BY_ONBOARDING_STEP: Record<OnboardingChecklistStep, DashboardPanel> = {
  venue: 'settings',
  reward: 'rewards',
  staff: 'settings',
  qr: 'settings',
}

interface ChecklistRow {
  step: OnboardingChecklistStep
  done: boolean
  /** i18n key and fallback for the row action. */
  key: string
  label: string
}

/** Render order: venue on the map, a reason to walk in, staff, then the QR. */
function rowsFor(status: OnboardingStatus): ChecklistRow[] {
  return [
    {
      step: 'venue',
      done: status.hasNode,
      key: 'biz.onboarding.row.venue',
      label: 'Add your venue so it appears on the map',
    },
    {
      step: 'reward',
      done: status.hasReward,
      key: 'biz.onboarding.row.reward',
      label: 'Publish one get so a first-timer has a reason to walk in',
    },
    {
      step: 'staff',
      done: status.hasStaff,
      key: 'biz.onboarding.row.staff',
      label: 'Invite a staff member to validate redemptions',
    },
    {
      step: 'qr',
      done: status.hasQr,
      key: 'biz.onboarding.row.qr',
      label: 'Turn on QR check-in and put the code where customers order',
    },
  ]
}

/** Decorative state marker. No emoji: an inline check glyph or an empty ring. */
function StepMarker({ done }: { done: boolean }) {
  if (!done) {
    return (
      <span aria-hidden="true" className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-[var(--border-strong)]" />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-[var(--accent)]"
    >
      <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="white" strokeWidth="2.5">
        <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function ChecklistRowButton({ row }: { row: ChecklistRow }) {
  const { t } = useTranslation()
  const setPanel = useBusinessStore((s) => s.setPanel)
  const label = t(row.key, row.label)

  return (
    <button
      type="button"
      data-testid={`onboarding-row-${row.step}`}
      data-panel={PANEL_BY_ONBOARDING_STEP[row.step]}
      onClick={() => setPanel(PANEL_BY_ONBOARDING_STEP[row.step])}
      aria-label={label}
      className="flex flex-row items-center gap-3 w-full min-h-11 px-3 py-2 rounded-xl text-left bg-[var(--bg-raised)] border border-[var(--border)] active:scale-95 transition-transform duration-150"
    >
      <StepMarker done={row.done} />
      <span
        className={`flex-1 text-sm ${row.done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'}`}
      >
        {label}
      </span>
      {!row.done && (
        <span className="flex-shrink-0 text-[var(--accent)] text-xs font-semibold">
          {t('biz.onboarding.rowCta', 'Open')}
        </span>
      )}
    </button>
  )
}

export function OnboardingChecklistCard() {
  const { t } = useTranslation()

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['business', 'onboarding-status'],
    queryFn: () => api.get<OnboardingStatus>('/v1/business/me/onboarding-status'),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div
        data-testid="onboarding-checklist-loading"
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5"
      >
        <span className="text-[var(--text-muted)] text-sm">
          {t('biz.onboarding.loading', 'Loading your setup steps…')}
        </span>
      </div>
    )
  }

  // No silent failure: a failed read shows what happened and a retry, never an
  // empty card that reads as "you are all set".
  if (error || !data) {
    return (
      <div
        data-testid="onboarding-checklist-error"
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-3"
      >
        <span className="text-[var(--danger)] text-sm">
          {t('biz.onboarding.error', "Couldn't load your setup steps. Please try again.")}
        </span>
        <button
          type="button"
          data-testid="onboarding-checklist-retry"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="self-start min-h-11 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold active:scale-95 transition-transform duration-150 disabled:opacity-60"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    )
  }

  const rows = rowsFor(data)
  const remaining = rows.filter((row) => !row.done).length

  // Complete setup: the card has nothing left to ask for (R5.2).
  if (remaining === 0) return null

  return (
    <div
      data-testid="onboarding-checklist"
      className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-4"
    >
      <div className="flex flex-row items-center justify-between gap-2">
        <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          {t('biz.onboarding.title', 'Finish your setup')}
        </h3>
        <span data-testid="onboarding-checklist-progress" className="text-[var(--text-muted)] text-xs">
          {rows.length - remaining} {t('biz.onboarding.progressOf', 'of')} {rows.length}{' '}
          {t('biz.onboarding.progressDone', 'done')}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <ChecklistRowButton key={row.step} row={row} />
        ))}
      </div>
    </div>
  )
}
