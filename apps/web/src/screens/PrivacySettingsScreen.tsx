import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { Avatar } from '@area-code/shared/components/Avatar'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { PrivacySettingsPicker } from '@area-code/shared/components/PrivacySettingsPicker'
import { BlockUserButton } from '@area-code/shared/components/BlockUserButton'
import { ChevronLeft } from 'lucide-react'
import type { Tier } from '@area-code/shared/types'
import type { AppRoute } from '../types'

interface PrivacySettingsScreenProps {
  onNavigate: (route: AppRoute) => void
}

interface BlockedUser {
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  tier: Tier
  blockedAt: string
}

export function PrivacySettingsScreen({ onNavigate }: PrivacySettingsScreenProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['blocked-users'],
    queryFn: () => api.get<{ blocked: BlockedUser[] }>('/v1/users/me/blocks'),
    staleTime: 30_000,
  })

  function handleUnblockToggle(userId: string, blocked: boolean) {
    if (!blocked) {
      // Optimistically remove from list
      queryClient.setQueryData<{ blocked: BlockedUser[] }>(['blocked-users'], (old) => {
        if (!old) return old
        return { blocked: old.blocked.filter((u) => u.userId !== userId) }
      })
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4" data-scroll-container>
      {/* Header with back button */}
      <div className="flex flex-row items-center gap-3 mb-6">
        <button
          onClick={() => onNavigate('profile')}
          className="text-[var(--text-muted)] text-sm transition-all active:scale-95"
          aria-label={t('privacy.back')}
        >
          <ChevronLeft size={16} strokeWidth={2} className="inline" /> {t('privacy.back')}
        </button>
      </div>

      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-6">{t('privacy.settings.heading')}</h1>

      {/* Privacy level picker */}
      <div className="mb-6">
        <PrivacySettingsPicker />
      </div>

      {/* Blocked users section */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
          {t('privacy.blockedUsers.title')}
        </h3>

        {isLoading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
        )}

        {!isLoading && (!data?.blocked || data.blocked.length === 0) && (
          <p className="text-[var(--text-muted)] text-sm text-center py-6">{t('privacy.blockedUsers.empty')}</p>
        )}

        {!isLoading && data?.blocked && data.blocked.length > 0 && (
          <div className="flex flex-col gap-2">
            {data.blocked.map((user) => (
              <div
                key={user.userId}
                className="flex flex-row items-center gap-3 bg-[var(--bg-raised)] rounded-2xl px-4 py-3"
              >
                <Avatar url={user.avatarUrl} displayName={user.displayName} size="sm" tier={user.tier} />
                <div className="flex-1">
                  <p className="text-[var(--text-primary)] text-sm font-medium">{user.displayName}</p>
                  <p className="text-[var(--text-muted)] text-xs">@{user.username}</p>
                </div>
                <BlockUserButton
                  targetUserId={user.userId}
                  isBlocked={true}
                  onToggle={(blocked) => handleUnblockToggle(user.userId, blocked)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
