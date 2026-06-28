import { timeAgo } from '../../lib/timeAgo'

import type { RecentClaim } from './types'

/**
 * "Just claimed near you" — anonymised social proof. Gets are the motivating
 * factor to go out, so showing live claim activity nearby is the nudge. Identity
 * is never shown (POPIA): only the get, venue, distance and recency.
 *
 * Horizontal snap strip so it reads as a lightweight ticker above the main feed,
 * not another full-width list competing with the ranked gets.
 */
export function RecentClaimsStrip({
  claims,
  t,
  onSelect,
}: {
  claims: RecentClaim[]
  t: (k: string) => string
  onSelect: (nodeId: string) => void
}) {
  if (claims.length === 0) return null

  return (
    <div className="mb-6">
      <h2 className="text-[var(--text-primary)] font-bold text-base font-[Syne] mb-1">
        {t('rewards.justClaimedNearYou')}
      </h2>
      <p className="text-[var(--text-muted)] text-xs mb-3">{t('rewards.justClaimedHint')}</p>
      <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1 snap-x snap-mandatory">
        {claims.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.nodeId)}
            aria-label={t('rewards.viewOnMap')}
            className="snap-start shrink-0 w-56 text-left bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-3 transition-all duration-150 hover:border-[var(--accent)] active:scale-[0.99] focus:outline-none focus:border-[var(--accent)]"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: 'var(--accent)' }}
                aria-hidden
              />
              <span className="text-[var(--text-muted)] text-[11px] font-medium">{timeAgo(c.claimedAt)}</span>
            </div>
            <p className="text-[var(--text-primary)] text-sm font-semibold leading-snug truncate">{c.rewardTitle}</p>
            <p className="text-[var(--text-secondary)] text-xs mt-0.5 truncate">{c.nodeName}</p>
            <p className="text-[var(--text-muted)] text-[11px] mt-1">{Math.round(c.distance)}m away</p>
          </button>
        ))}
      </div>
    </div>
  )
}
