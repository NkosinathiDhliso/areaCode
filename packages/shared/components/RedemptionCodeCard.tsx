import { CountdownBadge } from './CountdownBadge'

export interface RedemptionCodeCardProps {
  rewardTitle: string
  redemptionCode: string
  nodeName?: string
  codeExpiresAt?: string
  /** Optional helper copy shown beneath the code. */
  hint?: string
}

/**
 * Displays an earned reward's redemption code for the consumer to present
 * to venue staff. The code is rendered large and high-contrast so it can be
 * read across a counter; staff key it into the Staff portal (or scan it).
 *
 * This card is the consumer-facing half of the redemption loop - without it
 * an earned code never surfaces and the reward can't be redeemed.
 */
export function RedemptionCodeCard({
  rewardTitle,
  redemptionCode,
  nodeName,
  codeExpiresAt,
  hint = 'Show this code to staff to claim your reward.',
}: RedemptionCodeCardProps) {
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--accent)]/40 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex flex-row items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-sm font-medium truncate">{rewardTitle}</p>
          {nodeName ? <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate">{nodeName}</p> : null}
        </div>
        <CountdownBadge expiresAt={codeExpiresAt} />
      </div>

      <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl py-4 flex items-center justify-center">
        <span
          className="text-[var(--accent)] font-bold text-3xl tracking-[0.35em] font-[Syne] select-all"
          aria-label={`Redemption code ${redemptionCode.split('').join(' ')}`}
        >
          {redemptionCode}
        </span>
      </div>

      <p className="text-[var(--text-muted)] text-xs text-center">{hint}</p>
    </div>
  )
}
