import { CountdownBadge } from '@area-code/shared/components/CountdownBadge'
import type { NodeState } from '@area-code/shared/types'

import { getPulseStateColour } from '../../lib/mapHelpers'

import type { NearbyReward } from './types'

const PULSE_STATE_LABEL: Record<NodeState, string> = {
  popping: 'Popping',
  buzzing: 'Buzzing',
  active: 'Active',
  quiet: 'Quiet',
  dormant: 'Quiet',
}

const CATEGORY_LABEL: Record<'event' | 'offer', string> = {
  event: 'Event',
  offer: 'Offer',
}

/**
 * The vibe lead of a get card. Per the discovery-DNA rule the card leads with
 * aliveness, never distance. Per honest-presence we only claim a crowd when the
 * live count is real and positive; otherwise we under-claim ("Quiet right now").
 */
function VibeLead({ r }: { r: NearbyReward }) {
  const state: NodeState = r.pulseState ?? 'dormant'
  const colour = getPulseStateColour(state)
  const live = r.liveCount ?? 0
  const honestlyAlive = live > 0 && (state === 'active' || state === 'buzzing' || state === 'popping')

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ color: colour, backgroundColor: `${colour}1f` }}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colour }} aria-hidden />
        {PULSE_STATE_LABEL[state]}
      </span>
      {honestlyAlive ? (
        <span className="text-[var(--text-secondary)] text-[11px] font-medium">{live} here now</span>
      ) : (
        <span className="text-[var(--text-muted)] text-[11px]">Quiet right now</span>
      )}
    </div>
  )
}

export function RewardCard({
  reward: r,
  t,
  expired = false,
  onSelect,
}: {
  reward: NearbyReward
  t: (k: string) => string
  expired?: boolean
  onSelect?: (nodeId: string) => void
}) {
  const slotsLeft = r.totalSlots ? r.totalSlots - r.claimedCount : null
  const isLow = slotsLeft !== null && slotsLeft <= 5
  const interactive = !expired && !!onSelect
  const state: NodeState = r.pulseState ?? 'dormant'
  const accent = expired ? 'var(--border)' : getPulseStateColour(state)
  const category = r.getCategory === 'event' || r.getCategory === 'offer' ? r.getCategory : null

  const content = (
    <div className="flex flex-col gap-2">
      {!expired && (
        <div className="flex items-center justify-between gap-2">
          <VibeLead r={r} />
          {category && (
            <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {CATEGORY_LABEL[category]}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-row items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-base font-semibold leading-snug">{r.title}</p>
          <p className="text-[var(--text-secondary)] text-xs mt-0.5">{r.nodeName}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <CountdownBadge expiresAt={r.expiresAt} />
          {slotsLeft !== null && !expired && (
            <span className={`text-xs font-medium ${isLow ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
              {slotsLeft} {t('node.left')}
            </span>
          )}
        </div>
      </div>

      {/* Distance is a small, secondary hint only - never the lead. */}
      <p className="text-[var(--text-muted)] text-[11px]">{Math.round(r.distance)}m away</p>
    </div>
  )

  const baseClass = 'relative overflow-hidden bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 pl-5'
  const accentBar = (
    <span className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: accent }} aria-hidden />
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={() => onSelect!(r.nodeId)}
        aria-label={t('rewards.viewOnMap')}
        className={`${baseClass} text-left transition-all duration-150 hover:border-[var(--accent)] active:scale-[0.99] focus:outline-none focus:border-[var(--accent)]`}
      >
        {accentBar}
        {content}
      </button>
    )
  }

  return (
    <div className={`${baseClass} ${expired ? 'opacity-60' : ''}`}>
      {accentBar}
      {content}
    </div>
  )
}
