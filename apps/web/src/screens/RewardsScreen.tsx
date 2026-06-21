import { CountdownBadge } from '@area-code/shared/components/CountdownBadge'
import { EmptyState } from '@area-code/shared/components/EmptyState'
import { RedemptionCodeCard } from '@area-code/shared/components/RedemptionCodeCard'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { REWARD_EXPIRY_NOTICE } from '@area-code/shared/constants/legal'
import { useGeolocation, useUnclaimedRewards } from '@area-code/shared/hooks'
import { api } from '@area-code/shared/lib/api'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { NodeState } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { getPulseStateColour } from '../lib/mapHelpers'
import type { AppRoute } from '../types'

interface NearbyReward {
  id: string
  title: string
  type: string
  totalSlots: number | null
  claimedCount: number
  nodeId: string
  nodeName: string
  nodeSlug: string
  distance: number
  expiresAt: string | null
  /**
   * Honest aliveness signals from the backend. The feed is already ordered
   * vibe-first (aliveness → taste → proximity) server-side; these power the
   * "who's here now" lead on the card. `liveCount` is the honest CURRENT
   * presence (honest-presence rule), `pulseState` the venue's live vibe band.
   * Optional so an older/cached response without them degrades gracefully.
   */
  liveCount?: number
  pulseScore?: number
  pulseState?: NodeState
  getCategory?: 'loyalty' | 'event' | 'offer'
  lifecycle?: 'upcoming' | 'live' | 'ended'
}

interface RewardsScreenProps {
  onNavigate: (route: AppRoute) => void
}

export function RewardsScreen({ onNavigate }: RewardsScreenProps) {
  const { t } = useTranslation()
  const pos = useLocationStore((s) => s.lastKnownPosition)
  const connectivity = useConnectivityStore((s) => s.state)
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)
  const { requestLocation } = useGeolocation()

  /**
   * Acquire location on mount when missing.
   *
   * Without this, a hard refresh while sitting on /gets renders an empty
   * list: locationStore is not persisted, so `pos` is null until something
   * (previously only MapScreen) calls requestLocation. The query falls back
   * to the JHB downtown default coords, and any users elsewhere see "no
   * gets nearby". Refresh-on-/gets is the exact path the bug report calls
   * out - re-trigger the GPS request here so the screen is self-sufficient.
   */
  useEffect(() => {
    if (!isAuthenticated || pos) return
    void requestLocation()
  }, [isAuthenticated, pos, requestLocation])

  // Near-me rewards require auth
  const {
    data: rewards,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['rewards', 'near-me', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<NearbyReward[]>(`/v1/rewards/near-me?lat=${pos?.lat ?? -26.2041}&lng=${pos?.lng ?? 28.0473}`),
    enabled: connectivity !== 'offline' && isAuthenticated,
    staleTime: 30_000,
  })

  // Earned-but-unredeemed reward codes (the consumer's wallet). Surfaced at
  // the top so the code a user just earned is immediately presentable to staff.
  const { rewards: earnedCodes } = useUnclaimedRewards()

  /**
   * Tapping a reward card jumps to that venue on the map with its detail
   * sheet open. The map screen reads `focusNodeId` from the shared store and
   * handles the fly-to + sheet open in one effect.
   */
  function handleSelectReward(nodeId: string) {
    setFocusNodeId(nodeId)
    onNavigate('map')
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full px-5">
        <p className="text-[var(--text-muted)] text-sm text-center">{t('auth.gated.signIn')}</p>
      </div>
    )
  }

  if (connectivity === 'offline') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)] text-sm">{t('rewards.unavailableOffline')}</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full px-5">
        <p className="text-[var(--text-secondary)] text-sm text-center">
          {t('errors.loadFailed', 'Failed to load rewards. Please try again.')}
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      {earnedCodes.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[var(--text-primary)] font-bold text-lg font-[Syne] mb-1">{t('rewards.yourCodes')}</h2>
          <p className="text-[var(--text-muted)] text-xs mb-3">{t('rewards.yourCodesHint')}</p>
          <div className="flex flex-col gap-3">
            {earnedCodes.map((c) => (
              <RedemptionCodeCard
                key={c.id}
                rewardTitle={c.rewardTitle}
                redemptionCode={c.redemptionCode}
                nodeName={c.nodeName}
                codeExpiresAt={c.codeExpiresAt}
                hint={t('rewards.codeHint')}
              />
            ))}
          </div>
        </div>
      )}

      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-1">{t('rewards.nearYou')}</h1>
      <p className="text-[var(--text-muted)] text-xs mb-4">{REWARD_EXPIRY_NOTICE}</p>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : rewards && rewards.length > 0 ? (
        <RewardsList rewards={rewards} t={t} onSelect={handleSelectReward} />
      ) : (
        <EmptyState icon="reward" message={t('rewards.noneNearby')} />
      )}
    </div>
  )
}

function RewardsList({
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
 * The vibe lead of a get card. Per the discovery-DNA rule the card must LEAD
 * with aliveness + taste, never distance. Per the honest-presence rule we only
 * claim a crowd when the live count is real and positive; otherwise we
 * under-claim ("Quiet right now") rather than invent activity.
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

function RewardCard({
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
      {/* Lead with vibe + live crowd, never distance (discovery-DNA). */}
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

      {/* Distance is a small, secondary hint only — never the lead. */}
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
