import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { useUnclaimedRewards } from '@area-code/shared/hooks'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { TierProgressBar } from '@area-code/shared/components/TierProgressBar'
import { StreakDisplay } from '@area-code/shared/components/StreakDisplay'
import { Avatar } from '@area-code/shared/components/Avatar'
import { RedemptionCodeCard } from '@area-code/shared/components/RedemptionCodeCard'
import { TIER_PERMANENCE_SHORT } from '@area-code/shared/constants/legal'
import type { User } from '@area-code/shared/types'
import type { AppRoute } from '../types'
import { StreamingSection } from '../components/StreamingSection'

interface ProfileScreenProps {
  onNavigate: (route: AppRoute) => void
}

export function ProfileScreen({ onNavigate }: ProfileScreenProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const user = useUserStore((s) => s.user)
  const tier = useUserStore((s) => s.tier)
  const totalCheckIns = useUserStore((s) => s.totalCheckIns)
  const streakCount = useUserStore((s) => s.streakCount)
  const setUser = useUserStore((s) => s.setUser)
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
        <StatCard value={tier} label={t('profile.currentTier')} capitalize />
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
                hint={t('rewards.codeHint')}
              />
            ))}
          </div>
        </div>
      )}

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
    </div>
  )
}

function StatCard({ value, label, capitalize }: { value: string | number; label: string; capitalize?: boolean }) {
  return (
    <div className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 text-center">
      <p
        className={`text-[var(--text-primary)] font-bold text-xl font-[Syne] ${capitalize ? 'capitalize' : ''}`}
        style={{ letterSpacing: '-0.03em' }}
      >
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
