import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import type { ThemePreference } from '@area-code/shared/hooks/useTheme'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { TierProgressBar } from '@area-code/shared/components/TierProgressBar'
import { StreakDisplay } from '@area-code/shared/components/StreakDisplay'
import { Avatar } from '@area-code/shared/components/Avatar'
import { PrivacyIndicator } from '@area-code/shared/components/PrivacyIndicator'
import { Spinner } from '@area-code/shared/components/Spinner'
import { TIER_PERMANENCE_SHORT } from '@area-code/shared/constants/legal'
import type { User, PrivacyLevel } from '@area-code/shared/types'
import type { AppRoute } from '../types'
import { StreamingSection } from '../components/StreamingSection'
import { SessionsSection } from '../components/SessionsSection'

interface ProfileScreenProps {
  onNavigate: (route: AppRoute) => void
}

export function ProfileScreen({ onNavigate }: ProfileScreenProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const logout = useConsumerAuthStore((s) => s.logout)
  const sessionId = useConsumerAuthStore((s) => s.sessionId)
  const user = useUserStore((s) => s.user)
  const tier = useUserStore((s) => s.tier)
  const totalCheckIns = useUserStore((s) => s.totalCheckIns)
  const streakCount = useUserStore((s) => s.streakCount)
  const setUser = useUserStore((s) => s.setUser)
  const { preference, setPreference } = useTheme()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)

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

  const deleteHistoryMutation = useMutation({
    mutationFn: () => api.delete('/v1/users/me/check-in-history'),
    onSuccess: () => setShowDeleteConfirm(false),
  })

  const { data: privacyData } = useQuery({
    queryKey: ['privacy'],
    queryFn: () => api.get<{ privacyLevel: PrivacyLevel }>('/v1/users/me/privacy'),
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

  function handleLogout() {
    const currentSessionId = useConsumerAuthStore.getState().sessionId
    void api.post('/v1/auth/logout', { sessionId: currentSessionId ?? undefined }).catch(() => {})
    logout()
    onNavigate('map')
  }

  const displayUser = profile ?? user

  if (!displayUser && !isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-5 gap-4">
        <p className="text-[var(--text-secondary)] text-sm">{t('auth.gated.signIn')}</p>
        <button
          onClick={() => onNavigate('login')}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 px-8 text-sm transition-all duration-150 active:scale-95"
        >
          {t('auth.gated.signInButton')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4" data-scroll-container>
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
      </div>

      <p className="text-[var(--text-muted)] text-xs mb-6">{TIER_PERMANENCE_SHORT}</p>

      <div className="flex flex-row gap-4 mb-6">
        <StatCard value={totalCheckIns} label={t('profile.totalCheckIns')} />
        <StatCard value={streakCount} label={t('profile.currentStreak')} />
        <StatCard value={tier} label={t('profile.currentTier')} capitalize />
      </div>

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

      {isAuthenticated && <SessionsSection currentSessionId={sessionId} />}

      {/* Navigation links with proper chevron icons (Issue #24) */}
      <NavLink label={t('profile.checkInHistory', 'Check-in History')} onClick={() => onNavigate('history')} />
      <NavLink label={t('friends.title')} onClick={() => onNavigate('friends')} />
      <NavLink
        label={t('privacy.settings.link')}
        onClick={() => onNavigate('privacy')}
        trailing={privacyData ? <PrivacyIndicator privacyLevel={privacyData.privacyLevel} /> : undefined}
      />

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
          {t('profile.appearance')}
        </h3>
        <div className="flex flex-row gap-2">
          {(['auto', 'light', 'dark'] as ThemePreference[]).map((opt) => (
            <button
              key={opt}
              onClick={() => setPreference(opt)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                preference === opt
                  ? 'gradient-accent'
                  : 'bg-[var(--bg-raised)] text-[var(--text-secondary)] border border-[var(--border)]'
              }`}
            >
              {t(`profile.theme.${opt}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
        {/* Export as CSV (Issue #39) */}
        <button
          onClick={() => {
            void api.get<{ items: unknown[] }>('/v1/users/me/check-in-history?limit=50').then((data) => {
              const items = data.items as Array<Record<string, unknown>>
              if (!items.length) return
              const headers = Object.keys(items[0]!)
              const csv = [
                headers.join(','),
                ...items.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')),
              ].join('\n')
              const blob = new Blob([csv], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'check-in-history.csv'
              a.click()
              URL.revokeObjectURL(url)
            })
          }}
          className="w-full text-left text-[var(--text-primary)] text-sm py-2"
        >
          {t('profile.exportHistory')}
        </button>
        {/* Full data export (POPIA compliance) */}
        <button
          onClick={() => {
            void api
              .get<Record<string, unknown>>('/v1/users/me/data-export')
              .then((data) => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `area-code-data-export-${new Date().toISOString().slice(0, 10)}.json`
                a.click()
                URL.revokeObjectURL(url)
              })
              .catch(() => {
                useErrorStore.getState().showError(t('profile.exportFailed', "Couldn't download your data. Try again."))
              })
          }}
          className="w-full text-left text-[var(--text-primary)] text-sm py-2"
        >
          {t('profile.downloadData', 'Download my data')}
        </button>
        {/* Delete history with confirmation (Issue #4) */}
        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={deleteHistoryMutation.isPending}
          className="w-full text-left text-[var(--danger)] text-sm py-2"
        >
          {t('profile.deleteHistory')}
        </button>
      </div>

      <button
        onClick={handleLogout}
        className="w-full border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl py-3 text-sm mt-4"
      >
        {t('auth.gated.signOut')}
      </button>

      <button
        onClick={() => setShowDeleteAccountConfirm(true)}
        className="w-full text-[var(--danger)] text-sm mt-4 mb-4"
      >
        {t('profile.deleteAccount', 'Delete my account')}
      </button>

      {/* Delete confirmation dialog (Issue #4) */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('profile.deleteHistoryConfirmTitle', 'Delete check-in history?')}
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              {t(
                'profile.deleteHistoryConfirmBody',
                'This will permanently delete all your check-in history. This action cannot be undone.',
              )}
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => deleteHistoryMutation.mutate()}
                disabled={deleteHistoryMutation.isPending}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              >
                {deleteHistoryMutation.isPending ? (
                  <Spinner size="sm" className="border-white border-t-transparent" />
                ) : (
                  t('profile.deleteHistory')
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete account confirmation dialog */}
      {showDeleteAccountConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('profile.deleteAccountTitle', 'Delete your account?')}
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              {t(
                'profile.deleteAccountBody',
                'This will permanently delete your account, check-in history, rewards, and all associated data. This action cannot be undone.',
              )}
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setShowDeleteAccountConfirm(false)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => {
                  setDeletingAccount(true)
                  void api
                    .delete('/v1/users/me')
                    .then(() => {
                      logout()
                      onNavigate('landing')
                    })
                    .catch(() => {
                      setDeletingAccount(false)
                      setShowDeleteAccountConfirm(false)
                    })
                }}
                disabled={deletingAccount}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              >
                {deletingAccount ? (
                  <Spinner size="sm" className="border-white border-t-transparent" />
                ) : (
                  t('profile.deleteAccountConfirm', 'Delete account')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
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
