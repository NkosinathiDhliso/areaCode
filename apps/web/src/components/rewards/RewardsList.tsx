import { RewardCard } from './RewardCard'
import type { NearbyReward } from './types'

/**
 * The ranked "near you" get list. The server orders it taste-first; this only
 * splits live from locally-expired gets (expiry can lapse between fetches) and
 * renders them, preserving the ranked order within each group.
 */
export function RewardsList({
  rewards,
  t,
  onSelect,
}: {
  rewards: NearbyReward[]
  t: (k: string) => string
  onSelect: (nodeId: string) => void
}) {
  const now = Date.now()
  const live: NearbyReward[] = []
  const expired: NearbyReward[] = []
  for (const r of rewards) {
    if (r.expiresAt && Date.parse(r.expiresAt) <= now) expired.push(r)
    else live.push(r)
  }

  return (
    <div className="flex flex-col gap-6">
      {live.length > 0 && (
        <div className="flex flex-col gap-3">
          {live.map((r) => (
            <RewardCard key={r.id} reward={r} t={t} onSelect={onSelect} />
          ))}
        </div>
      )}
      {expired.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[var(--text-muted)] text-xs uppercase tracking-wide">{t('rewards.expiredHeading')}</h2>
          {expired.map((r) => (
            <RewardCard key={r.id} reward={r} t={t} expired />
          ))}
        </div>
      )}
    </div>
  )
}
