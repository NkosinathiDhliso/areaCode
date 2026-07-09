import { Avatar } from '@area-code/shared/components/Avatar'
import { RedemptionCodeCard } from '@area-code/shared/components/RedemptionCodeCard'
import { StreakDisplay } from '@area-code/shared/components/StreakDisplay'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { TierProgressBar } from '@area-code/shared/components/TierProgressBar'
import { TIER_PERMANENCE_SHORT } from '@area-code/shared/constants/legal'
import { getTierLabel } from '@area-code/shared/constants/tier-levels'
import { useUnclaimedRewards } from '@area-code/shared/hooks'
import { api } from '@area-code/shared/lib/api'
import { haptic } from '@area-code/shared/lib/haptics'
import {
  createRapidTapDetector,
  TROPHY_TAP_COUNT,
  TROPHY_TAP_GAP_MS,
  type RapidTapDetector,
} from '@area-code/shared/lib/rapidTap'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import type { User } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ParkedCheckinsSection } from '../components/ParkedCheckinsSection'
import { RankTrophyOverlay } from '../components/RankTrophyOverlay'
import { StreamingSection } from '../components/StreamingSection'
import type { AppRoute } from '../types'

interface ProfileScreenProps {
  onNavigate: (route: AppRoute) => void
}

/**
 * Trophy_Tap trigger (Hidden_Delight HD-2, Requirement 4.3-4.5). Owns the pure
 * rapid-tap detector for the profile rank card and the overlay `playing` state.
 *
 * The detector is created once and kept in a ref: it is pure and has no timers,
 * so there is nothing to clean up. A tap fires `haptic(10)` (a short tick) and
 * opens the overlay only on `TROPHY_TAP_COUNT` consecutive taps within
 * `TROPHY_TAP_GAP_MS` of each other; single and double taps do nothing but the
 * card's own `active:scale-95` pressed feedback (Requirement 4.4).
 *
 * While the overlay is open the detector is not consulted, so a tap can never
 * re-arm or re-trigger it (Requirement 4.5). The open overlay is a full-screen
 * layer above the card and dismisses on any tap itself, so taps while open
 * dismiss only. There is no hint copy anywhere: discovery is word-of-mouth
 * (Requirement 6.1).
 */
function useTrophyTap() {
  const [playing, setPlaying] = useState(false)
  const detectorRef = useRef<RapidTapDetector | null>(null)
  if (detectorRef.current === null) {
    detectorRef.current = createRapidTapDetector({ taps: TROPHY_TAP_COUNT, gapMs: TROPHY_TAP_GAP_MS })
  }

  const onPointerDown = useCallback(() => {
    // Never re-arm while the overlay is open; dismissal is the overlay's own
    // click-anywhere handler, which sits above the card (Requirement 4.5).
    if (playing) return
    if (detectorRef.current?.tap()) {
      haptic(10)
      setPlaying(true)
    }
  }, [playing])

  const dismiss = useCallback(() => setPlaying(false), [])

  return { playing, onPointerDown, dismiss }
}

export function ProfileScreen({ onNavigate }: ProfileScreenProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const user = useUserStore((s) => s.user)
  const tier = useUserStore((s) => s.tier)
  const totalCheckIns = useUserStore((s) => s.totalCheckIns)
  const streakCount = useUserStore((s) => s.streakCount)
  const setUser = useUserStore((s) => s.setUser)
  // Trophy_Tap (HD-2): hooks stay above the auth early return (code-style).
  const { playing: trophyPlaying, onPointerDown: onRankCardPointerDown, dismiss: dismissTrophy } = useTrophyTap()
  // The consumer's wallet of earned-but-unredeemed get codes. Lives here now
  // that the standalone gets tab is gone; it is pure utility (a code to show
  // staff), not a discovery surface.
  const { rewards: earnedCodes } = useUnclaimedRewards()

  const { data: profile } = useQuery({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const u = await api.get<User & { streakCount?: number }>('/v1/users/me')
      setUser(u)
      if (typeof u.streakCount === 'number') {
        useUserStore.getState().setStreak(u.streakCount)
      }
      return u
    },
    staleTime: 60_000,
  })

  interface TierProgressData {
    currentTier: import('@area-code/shared/types').Tier
    nextTier: import('@area-code/shared/types').Tier | null
    currentCheckIns: number
    nextTierThreshold: number | null
    checkInsRemaining: number
    benefits: string[]
  }

  const { data: tierProgress } = useQuery({
    queryKey: ['tier-progress'],
    queryFn: () => api.get<TierProgressData>('/v1/users/me/tier-progress'),
    staleTime: 60_000,
  })

  interface StreakData {
    streakCount: number
    streakStartDate: string | null
    atRisk: boolean
  }

  const { data: streakData } = useQuery({
    queryKey: ['streak'],
    queryFn: () => api.get<StreakData>('/v1/users/me/streak'),
    staleTime: 60_000,
  })

  const displayUser = profile ?? user

  if (!displayUser && !isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-5 gap-4">
        <p className="text-[var(--text-secondary)] text-sm">{t('auth.gated.signIn')}</p>
        <button
          onClick={() => onNavigate('login')}
          className="bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-3 px-8 text-sm transition-all duration-150 active:scale-95"
        >
          {t('auth.gated.signInButton')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      <div className="flex flex-row items-center gap-4 mb-6">
        <Avatar
          url={displayUser?.avatarUrl ?? null}
          displayName={displayUser?.displayName ?? ''}
          size="lg"
          tier={tier}
        />
        <div className="flex-1">
          <h1 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">{displayUser?.displayName}</h1>
          <p className="text-[var(--text-muted)] text-sm">@{displayUser?.username}</p>
        </div>
        <TierBadge tier={tier} />
        <button
          onClick={() => onNavigate('settings')}
          aria-label={t('profile.settings')}
          className="w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] transition-all active:scale-95"
        >
          <Settings size={22} strokeWidth={2} />
        </button>
      </div>

      <p className="text-[var(--text-muted)] text-xs mb-6">{TIER_PERMANENCE_SHORT}</p>

      <div className="flex flex-row gap-4 mb-6">
        <StatCard value={totalCheckIns} label={t('profile.totalCheckIns')} />
        <StatCard value={streakCount} label={t('profile.currentStreak')} />
        {/* Rank card: the single Trophy_Tap tap target (Requirement 4.3). The
            StatCard is already >= 44px tall (p-4); min-h-11 guarantees the 44px
            minimum, and active:scale-95 is the only feedback a tap gets until
            the burst fires (Requirement 4.4). No label or hint references the
            gesture (Requirement 6.1). */}
        <div
          data-testid="rank-card"
          onPointerDown={onRankCardPointerDown}
          className="flex-1 min-h-11 transition-transform active:scale-95"
        >
          <StatCard value={getTierLabel(tier)} label={t('profile.currentTier')} />
        </div>
      </div>

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
                venueActive={c.venueActive}
                hint={t('rewards.codeHint')}
              />
            ))}
          </div>
        </div>
      )}

      <ParkedCheckinsSection />

      {tierProgress && (
        <div className="mb-3">
          <TierProgressBar
            currentTier={tierProgress.currentTier}
            currentCheckIns={tierProgress.currentCheckIns}
            nextTier={tierProgress.nextTier}
            nextTierThreshold={tierProgress.nextTierThreshold}
            checkInsRemaining={tierProgress.checkInsRemaining}
          />
        </div>
      )}

      {streakData && (
        <div className="mb-3">
          <StreakDisplay
            streakCount={streakData.streakCount}
            streakStartDate={streakData.streakStartDate}
            atRisk={streakData.atRisk}
          />
        </div>
      )}

      <StreamingSection />

      {/* Navigation links with proper chevron icons (Issue #24) */}
      <NavLink label={t('profile.checkInHistory', 'Check-in History')} onClick={() => onNavigate('history')} />
      <NavLink label={t('profile.notifications', 'Notifications')} onClick={() => onNavigate('notifications')} />
      <NavLink label={t('friends.title')} onClick={() => onNavigate('friends')} />

      {/* Trophy_Tap celebration (HD-2). Full-screen decorative layer that plays
          the user's own current rank (Requirement 5.9). It renders nothing when
          not playing, so the profile behind it is never disturbed. */}
      <RankTrophyOverlay tier={tier} playing={trophyPlaying} onDone={dismissTrophy} />
    </div>
  )
}

function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 text-center">
      <p className="text-[var(--text-primary)] font-bold text-xl font-[Syne]" style={{ letterSpacing: '-0.03em' }}>
        {value}
      </p>
      <p className="text-[var(--text-muted)] text-xs mt-1">{label}</p>
    </div>
  )
}

function NavLink({ label, onClick, trailing }: { label: string; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex flex-row items-center justify-between bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 mb-3 transition-all active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <span className="text-[var(--text-primary)] text-sm font-medium">{label}</span>
        {trailing}
      </div>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}
