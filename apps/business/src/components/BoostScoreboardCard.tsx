import { api } from '@area-code/shared/lib/api'
import type { BoostScoreboardPeriodView, BoostScoreboardView } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

/* ------------------------------------------------------------------ */
/*  What one boost purchase's window recorded (proof-of-demand R7.1,   */
/*  R7.4, R7.5).                                                       */
/*                                                                     */
/*  Three rules this card must never break:                            */
/*   - Counts always render, for both windows. A window that recorded   */
/*     nothing is reported as nothing: neither a failure nor a claim.   */
/*   - The comparison renders ONLY when the server says the two         */
/*     samples may be set against each other. Below the                 */
/*     Suppression_Floor there is no delta to show, and the card says    */
/*     so instead of implying a trend.                                  */
/*   - Measurement verbs only. The scoreboard reports who checked in     */
/*     inside the window and who checked in the same hours last week.    */
/*     It never says the boost brought, drove or generated anyone.       */
/* ------------------------------------------------------------------ */

interface BoostScoreboardCardProps {
  /** The purchase's `yocoCheckoutId`, the id the endpoint is keyed on. */
  boostId: string
}

/** "1 check-in" / "2 check-ins". */
function checkInsWord(count: number): string {
  return count === 1 ? 'check-in' : 'check-ins'
}

/** "1 person" / "2 people". */
function peopleWord(count: number): string {
  return count === 1 ? 'person' : 'people'
}

/**
 * The readings for one window, in the order the discovery surfaces use: visits,
 * then people, then the Found_You and Walk_In split. Rendered for both windows
 * with the same builder, so the two can never be described differently.
 */
export function boostPeriodCounts(period: BoostScoreboardPeriodView): string {
  return [
    `${period.checkIns} ${checkInsWord(period.checkIns)} from ${period.visitors} ${peopleWord(period.visitors)}`,
    `${period.foundYou} found you`,
    `${period.walkIns} already in the room`,
  ].join(' · ')
}

/** "+3" / "-2" / "0". A quieter window than last week is a real answer. */
export function signedCount(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

const CARD_CLASS = 'bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-1'

export function BoostScoreboardCard({ boostId }: BoostScoreboardCardProps) {
  const { t } = useTranslation()

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['business', 'boost-scoreboard', boostId],
    queryFn: () => api.get<BoostScoreboardView>(`/v1/business/boosts/${boostId}/scoreboard`),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div data-testid={`boost-scoreboard-loading-${boostId}`} className={CARD_CLASS}>
        <div className="h-3 w-48 bg-[var(--bg-surface)] rounded-lg animate-pulse" />
        <div className="h-3 w-36 bg-[var(--bg-surface)] rounded-lg animate-pulse" />
      </div>
    )
  }

  // No silent failure and no partial numbers: the owner is told the window could
  // not be read, with a retry of its own.
  if (error || !data) {
    return (
      <div data-testid={`boost-scoreboard-error-${boostId}`} className={CARD_CLASS}>
        <span className="text-[var(--danger)] text-xs">
          {t('biz.boost.scoreboard.error', "Couldn't load what this window recorded.")}
        </span>
        <button
          type="button"
          data-testid={`boost-scoreboard-retry-${boostId}`}
          onClick={() => void refetch()}
          disabled={isFetching}
          className="self-start min-h-11 px-4 rounded-xl border border-[var(--border-strong)] text-[var(--text-primary)] text-xs font-semibold active:scale-95 transition-transform duration-150 disabled:opacity-60"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    )
  }

  return (
    <div data-testid={`boost-scoreboard-${boostId}`} className={CARD_CLASS}>
      {/* Found_You is the highlighted line: the one reading the owner bought. */}
      <p data-testid={`boost-scoreboard-foundyou-${boostId}`} className="text-[var(--accent)] text-sm font-medium">
        {data.window.foundYou > 0
          ? `${data.window.foundYou} found you on Area Code and checked in during the window.`
          : t('biz.boost.scoreboard.noFoundYou', 'No one found you on Area Code during this window.')}
      </p>

      <p data-testid={`boost-scoreboard-window-${boostId}`} className="text-[var(--text-secondary)] text-xs">
        {`${t('biz.boost.scoreboard.windowLabel', 'In the window')}: ${boostPeriodCounts(data.window)}`}
      </p>

      <p data-testid={`boost-scoreboard-baseline-${boostId}`} className="text-[var(--text-secondary)] text-xs">
        {`${t('biz.boost.scoreboard.baselineLabel', 'Same hours last week')}: ${boostPeriodCounts(data.baseline)}`}
      </p>

      {/* Only ever rendered when the server says both samples support it. */}
      {data.comparable && data.delta && (
        <p data-testid={`boost-scoreboard-delta-${boostId}`} className="text-[var(--text-primary)] text-xs">
          {`${t('biz.boost.scoreboard.deltaLabel', 'Against last week')}: ${signedCount(data.delta.foundYou)} found you, ${signedCount(data.delta.checkIns)} ${checkInsWord(Math.abs(data.delta.checkIns))}`}
        </p>
      )}

      {!data.comparable && (
        <p data-testid={`boost-scoreboard-nocompare-${boostId}`} className="text-[var(--text-muted)] text-xs">
          {t('biz.boost.scoreboard.notComparable', 'Too few check-ins in one of the two windows to compare them.')}
        </p>
      )}

      {data.window.checkIns === 0 && (
        <p data-testid={`boost-scoreboard-zero-${boostId}`} className="text-[var(--text-muted)] text-xs">
          {t('biz.boost.scoreboard.zero', 'No check-ins were recorded in this window.')}
        </p>
      )}

      {!data.windowClosed && (
        <p data-testid={`boost-scoreboard-open-${boostId}`} className="text-[var(--text-muted)] text-xs">
          {t('biz.boost.scoreboard.open', 'This window is still open, so these counts can still change.')}
        </p>
      )}
    </div>
  )
}
