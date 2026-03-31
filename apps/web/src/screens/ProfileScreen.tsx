import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import type { ThemePreference } from '@area-code/shared/hooks/useTheme'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { Avatar } from '@area-code/shared/components/Avatar'
import type { User } from '@area-code/shared/types'
import type { AppRoute } from '../types'

interface ProfileScreenProps {
  onNavigate: (route: AppRoute) => void
}

export function ProfileScreen({ onNavigate }: ProfileScreenProps) {
  const { t } = useTranslation()
  const { isAuthenticated, logout } = useConsumerAuthStore()
  const { user, tier, totalCheckIns, streakCount, setUser } = useUserStore()
  const { preference, setPreference } = useTheme()

  const { data: profile } = useQuery({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const u = await api.get<User>('/v1/users/me')
      setUser(u)
      return u
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  })

  const deleteHistoryMutation = useMutation({
    mutationFn: () => api.delete('/v1/users/me/check-in-history'),
  })

  function handleLogout() {
    void api.post('/v1/auth/logout', {}).catch(() => {})
    logout()
    onNavigate('map')
  }

  if (!isAuthenticated) {
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

  const displayUser = profile ?? user

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4">
      <div className="flex flex-row items-center gap-4 mb-6">
        <Avatar
          url={displayUser?.avatarUrl ?? null}
          displayName={displayUser?.displayName ?? ''}
          size="lg"
          tier={tier}
        />
        <div className="flex-1">
          <h1 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
            {displayUser?.displayName}
          </h1>
          <p className="text-[var(--text-muted)] text-sm">@{displayUser?.username}</p>
        </div>
        <TierBadge tier={tier} />
      </div>

      <div className="flex flex-row gap-4 mb-6">
        <StatCard value={totalCheckIns} label={t('profile.totalCheckIns')} />
        <StatCard value={streakCount} label={t('profile.currentStreak')} />
        <StatCard value={tier} label={t('profile.currentTier')} capitalize />
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
          {t('profile.privacy')}
        </h3>
        <label className="flex flex-row items-center justify-between">
          <span className="text-[var(--text-primary)] text-sm">{t('profile.privacyToggle')}</span>
          <input type="checkbox" defaultChecked className="accent-[var(--accent)]" />
        </label>
      </div>

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
        <button className="w-full text-left text-[var(--text-primary)] text-sm py-2">
          {t('profile.exportHistory')}
        </button>
        <button
          onClick={() => deleteHistoryMutation.mutate()}
          disabled={deleteHistoryMutation.isPending}
          className="w-full text-left text-[var(--danger)] text-sm py-2"
        >
          {t('profile.deleteHistory')}
        </button>
      </div>

      <button onClick={handleLogout} className="w-full border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl py-3 text-sm mt-4">
        {t('auth.gated.signOut')}
      </button>
    </div>
  )
}

/** Extracted stat card to keep ProfileScreen focused. */
function StatCard({ value, label, capitalize }: { value: string | number; label: string; capitalize?: boolean }) {
  return (
    <div className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 text-center">
      <p className={`text-[var(--text-primary)] font-bold text-xl font-[Syne] ${capitalize ? 'capitalize' : ''}`} style={{ letterSpacing: '-0.03em' }}>
        {value}
      </p>
      <p className="text-[var(--text-muted)] text-xs mt-1">{label}</p>
    </div>
  )
}
