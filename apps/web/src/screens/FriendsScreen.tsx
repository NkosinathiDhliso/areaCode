import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { Avatar } from '@area-code/shared/components/Avatar'
import { TierBadge } from '@area-code/shared/components/TierBadge'
import { Skeleton } from '@area-code/shared/components/Skeleton'
import type { Tier } from '@area-code/shared/types'

type Tab = 'friends' | 'following' | 'followers' | 'search'

interface FriendEntry {
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  tier: Tier
  totalCheckIns?: number
}

interface FollowingEntry extends FriendEntry {
  isMutual: boolean
}

interface FollowerEntry extends FriendEntry {
  isFollowingBack: boolean
}

interface SearchEntry extends FriendEntry {
  isFollowing: boolean
  isMutual: boolean
}

export function FriendsScreen() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('friends')
  const [search, setSearch] = useState('')

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4">
      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-4">
        {t('friends.title')}
      </h1>

      {/* Tab bar */}
      <div className="flex flex-row gap-1 mb-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-1">
        {(['friends', 'following', 'followers', 'search'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
              tab === t
                ? 'gradient-accent text-white'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            {t === 'search' ? '🔍' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'friends' && <FriendsTab />}
      {tab === 'following' && <FollowingTab />}
      {tab === 'followers' && <FollowersTab />}
      {tab === 'search' && <SearchTab search={search} setSearch={setSearch} />}
    </div>
  )
}

function FriendsTab() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get<{ friends: FriendEntry[]; count: number }>('/v1/users/me/friends'),
    staleTime: 30_000,
  })

  if (isLoading) return <LoadingSkeleton />

  if (!data?.friends.length) {
    return <EmptyState message={t('friends.noFriends')} />
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[var(--text-muted)] text-xs mb-1">
        {t('friends.mutualCount', { count: data.count })}
      </p>
      {data.friends.map((f) => (
        <UserRow key={f.userId} user={f} badge={t('friends.mutual')} badgeColor="var(--success)" />
      ))}
    </div>
  )
}

function FollowingTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['following'],
    queryFn: () => api.get<{ users: FollowingEntry[]; count: number }>('/v1/users/me/following'),
    staleTime: 30_000,
  })

  const unfollowMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/v1/users/${userId}/follow`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['following'] })
      void queryClient.invalidateQueries({ queryKey: ['friends'] })
    },
  })

  if (isLoading) return <LoadingSkeleton />

  if (!data?.users.length) {
    return <EmptyState message={t('friends.notFollowingAnyone')} />
  }

  return (
    <div className="flex flex-col gap-2">
      {data.users.map((u) => (
        <div key={u.userId} className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
          <Avatar url={u.avatarUrl} displayName={u.displayName} size="sm" tier={u.tier} />
          <div className="flex-1">
            <p className="text-[var(--text-primary)] text-sm font-medium">{u.displayName}</p>
            <p className="text-[var(--text-muted)] text-xs">@{u.username}</p>
          </div>
          {u.isMutual && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--success)]/10 text-[var(--success)]">
              {t('friends.mutual')}
            </span>
          )}
          <button
            onClick={() => unfollowMutation.mutate(u.userId)}
            disabled={unfollowMutation.isPending}
            className="text-xs text-[var(--danger)] border border-[var(--danger)]/30 rounded-xl px-3 py-1.5 transition-all active:scale-95"
          >
            {t('friends.unfollow')}
          </button>
        </div>
      ))}
    </div>
  )
}

function FollowersTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['followers'],
    queryFn: () => api.get<{ users: FollowerEntry[]; count: number }>('/v1/users/me/followers'),
    staleTime: 30_000,
  })

  const followMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/v1/users/${userId}/follow`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['followers'] })
      void queryClient.invalidateQueries({ queryKey: ['friends'] })
      void queryClient.invalidateQueries({ queryKey: ['following'] })
    },
  })

  if (isLoading) return <LoadingSkeleton />

  if (!data?.users.length) {
    return <EmptyState message={t('friends.noFollowers')} />
  }

  return (
    <div className="flex flex-col gap-2">
      {data.users.map((u) => (
        <div key={u.userId} className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
          <Avatar url={u.avatarUrl} displayName={u.displayName} size="sm" tier={u.tier} />
          <div className="flex-1">
            <p className="text-[var(--text-primary)] text-sm font-medium">{u.displayName}</p>
            <p className="text-[var(--text-muted)] text-xs">@{u.username}</p>
          </div>
          {u.isFollowingBack ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--success)]/10 text-[var(--success)]">
              {t('friends.mutual')}
            </span>
          ) : (
            <button
              onClick={() => followMutation.mutate(u.userId)}
              disabled={followMutation.isPending}
              className="text-xs text-white gradient-accent rounded-xl px-3 py-1.5 transition-all active:scale-95"
            >
              {t('friends.followBack')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function SearchTab({ search, setSearch }: { search: string; setSearch: (s: string) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['user-search', search],
    queryFn: () => api.get<{ users: SearchEntry[] }>(`/v1/users/search?q=${encodeURIComponent(search)}`),
    enabled: search.length >= 2,
    staleTime: 10_000,
  })

  const followMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/v1/users/${userId}/follow`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-search'] })
      void queryClient.invalidateQueries({ queryKey: ['friends'] })
      void queryClient.invalidateQueries({ queryKey: ['following'] })
    },
  })

  const unfollowMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/v1/users/${userId}/follow`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-search'] })
      void queryClient.invalidateQueries({ queryKey: ['friends'] })
      void queryClient.invalidateQueries({ queryKey: ['following'] })
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('friends.searchPlaceholder')}
        className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        autoFocus
      />

      {isLoading && search.length >= 2 && <LoadingSkeleton count={3} />}

      {data?.users && data.users.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.users.map((u) => (
            <div key={u.userId} className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
              <Avatar url={u.avatarUrl} displayName={u.displayName} size="sm" tier={u.tier} />
              <div className="flex-1">
                <p className="text-[var(--text-primary)] text-sm font-medium">{u.displayName}</p>
                <p className="text-[var(--text-muted)] text-xs">@{u.username}</p>
              </div>
              <TierBadge tier={u.tier} />
              {u.isMutual ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--success)]/10 text-[var(--success)]">
                  {t('friends.mutual')}
                </span>
              ) : u.isFollowing ? (
                <button
                  onClick={() => unfollowMutation.mutate(u.userId)}
                  disabled={unfollowMutation.isPending}
                  className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-xl px-3 py-1.5 transition-all active:scale-95"
                >
                  {t('friends.following')}
                </button>
              ) : (
                <button
                  onClick={() => followMutation.mutate(u.userId)}
                  disabled={followMutation.isPending}
                  className="text-xs text-white gradient-accent rounded-xl px-3 py-1.5 transition-all active:scale-95"
                >
                  {t('friends.follow')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {search.length >= 2 && !isLoading && data?.users?.length === 0 && (
        <EmptyState message={t('friends.noResults')} />
      )}

      {search.length < 2 && (
        <p className="text-[var(--text-muted)] text-xs text-center py-4">
          {t('friends.searchHint')}
        </p>
      )}
    </div>
  )
}

function UserRow({ user, badge, badgeColor }: { user: FriendEntry; badge?: string; badgeColor?: string }) {
  return (
    <div className="flex flex-row items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
      <Avatar url={user.avatarUrl} displayName={user.displayName} size="sm" tier={user.tier} />
      <div className="flex-1">
        <p className="text-[var(--text-primary)] text-sm font-medium">{user.displayName}</p>
        <p className="text-[var(--text-muted)] text-xs">@{user.username}</p>
      </div>
      <TierBadge tier={user.tier} />
      {badge && (
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={{ color: badgeColor, backgroundColor: `${badgeColor}15` }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

function LoadingSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-2xl" />
      ))}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-[var(--text-muted)] text-sm text-center py-8">{message}</p>
  )
}
