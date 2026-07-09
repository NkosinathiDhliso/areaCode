import { Avatar } from '@area-code/shared/components/Avatar'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { api } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { Tier } from '@area-code/shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { UserActionsMenu } from './UserActionsMenu'

interface PublicProfile {
  userId: string
  displayName: string | null
  username: string | null
  avatarUrl: string | null
  tier: Tier
  totalCheckIns: number | null
  isFollowing: boolean
  isFollowedBy: boolean
  isMutual: boolean
  visibility: 'full' | 'anonymous'
}

/**
 * Bottom-sheet profile for another consumer, opened from any user row. Shows
 * identity + tier + relationship and exposes follow/unfollow plus block/report,
 * so every action a user needs against another person is reachable from one
 * place. Privacy is enforced server-side: an anonymous (friends_only
 * non-mutual) target comes back with identity nulled; a blocked/private target
 * 404s and we render a neutral not-found state.
 */
export function UserProfileSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => api.get<PublicProfile>(`/v1/users/${userId}/profile`),
    staleTime: 15_000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['user-profile', userId] })
    void queryClient.invalidateQueries({ queryKey: ['friends'] })
    void queryClient.invalidateQueries({ queryKey: ['following'] })
    void queryClient.invalidateQueries({ queryKey: ['followers'] })
    void queryClient.invalidateQueries({ queryKey: ['user-search'] })
  }

  const followMutation = useMutation({
    mutationFn: () => api.post(`/v1/users/${userId}/follow`, {}),
    onSuccess: invalidate,
    onError: () => useErrorStore.getState().showError(t('friends.followError', "Couldn't follow. Try again.")),
  })

  const unfollowMutation = useMutation({
    mutationFn: () => api.delete(`/v1/users/${userId}/follow`),
    onSuccess: invalidate,
    onError: () => useErrorStore.getState().showError(t('friends.unfollowError', "Couldn't unfollow. Try again.")),
  })

  const name = data?.displayName || data?.username || t('leaderboard.anonymousExplorer', 'Explorer')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] rounded-t-3xl p-5"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-[var(--text-muted)] text-sm text-center">
              {t('friends.profileUnavailable', 'This profile is unavailable.')}
            </p>
            <button
              onClick={onClose}
              className="text-sm text-white gradient-accent rounded-xl px-4 py-2 transition-all active:scale-95"
            >
              {t('common.done', 'Done')}
            </button>
          </div>
        )}

        {data && !isLoading && (
          <>
            <div className="flex flex-row items-center gap-3 mb-4">
              <Avatar url={data.avatarUrl} displayName={name} size="lg" tier={data.tier} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-row items-center gap-2">
                  <p className="text-[var(--text-primary)] text-lg font-bold font-[Syne] truncate">{name}</p>
                  <TierBadge tier={data.tier} />
                </div>
                {data.username && <p className="text-[var(--text-muted)] text-sm truncate">@{data.username}</p>}
                {data.isMutual ? (
                  <span className="text-[10px] text-[var(--success)]">{t('friends.mutual')}</span>
                ) : data.isFollowedBy ? (
                  <span className="text-[10px] text-[var(--text-muted)]">{t('friends.followsYou', 'Follows you')}</span>
                ) : null}
              </div>
              <UserActionsMenu targetUserId={data.userId} targetName={name} onBlocked={onClose} />
            </div>

            {data.totalCheckIns !== null && (
              <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 mb-4">
                <p className="text-[var(--text-muted)] text-xs">{t('profile.totalCheckIns', 'Total check-ins')}</p>
                <p className="text-[var(--text-primary)] text-xl font-bold">{data.totalCheckIns}</p>
              </div>
            )}

            {data.visibility === 'anonymous' && (
              <p className="text-[var(--text-muted)] text-xs mb-4">
                {t('friends.profilePrivate', 'This person shares their activity with friends only.')}
              </p>
            )}

            {data.isFollowing ? (
              <button
                onClick={() => unfollowMutation.mutate()}
                disabled={unfollowMutation.isPending}
                className="w-full text-sm text-[var(--danger)] border border-[var(--danger)]/30 rounded-xl px-4 py-3 transition-all active:scale-95"
              >
                {t('friends.unfollow')}
              </button>
            ) : (
              <button
                onClick={() => followMutation.mutate()}
                disabled={followMutation.isPending}
                className="w-full text-sm text-white gradient-accent rounded-xl px-4 py-3 transition-all active:scale-95"
              >
                {data.isFollowedBy ? t('friends.followBack') : t('friends.follow')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
