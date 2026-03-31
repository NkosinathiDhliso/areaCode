import { useState } from 'react'
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import type { Tier } from '@area-code/shared/types'
import { AvatarCircle } from '../src/components/AvatarCircle'
import { NativeTierBadge } from '../src/components/NativeTierBadge'
import { SkeletonBox } from '../src/components/Skeleton'
import { colors } from '../src/theme'

type Tab = 'friends' | 'following' | 'followers' | 'search'

interface FriendEntry {
  userId: string; username: string; displayName: string
  avatarUrl: string | null; tier: Tier; totalCheckIns?: number
}
interface FollowingEntry extends FriendEntry { isMutual: boolean }
interface FollowerEntry extends FriendEntry { isFollowingBack: boolean }
interface SearchEntry extends FriendEntry { isFollowing: boolean; isMutual: boolean }

export default function FriendsScreen() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('friends')
  const [search, setSearch] = useState('')

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('friends.title')}</Text>

      <View style={styles.tabBar}>
        {(['friends', 'following', 'followers', 'search'] as Tab[]).map((tb) => (
          <TouchableOpacity
            key={tb}
            style={[styles.tab, tab === tb && styles.tabActive]}
            onPress={() => setTab(tb)}
          >
            <Text style={[styles.tabText, tab === tb && styles.tabTextActive]}>
              {tb === 'search' ? '🔍' : tb.charAt(0).toUpperCase() + tb.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'friends' && <FriendsTab />}
      {tab === 'following' && <FollowingTab />}
      {tab === 'followers' && <FollowersTab />}
      {tab === 'search' && <SearchTab search={search} setSearch={setSearch} />}
    </ScrollView>
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
  if (!data?.friends.length) return <EmptyState message={t('friends.noFriends')} />
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.mutedSmall}>{t('friends.mutualCount', { count: data.count })}</Text>
      {data.friends.map((f) => (
        <UserRow key={f.userId} user={f} badge={t('friends.mutual')} />
      ))}
    </View>
  )
}

function FollowingTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['following'],
    queryFn: () => api.get<{ users: FollowingEntry[]; count: number }>('/v1/users/me/following'),
    staleTime: 30_000,
  })
  const unfollow = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/users/${id}/follow`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['following'] }); void qc.invalidateQueries({ queryKey: ['friends'] }) },
  })
  if (isLoading) return <LoadingSkeleton />
  if (!data?.users.length) return <EmptyState message={t('friends.notFollowingAnyone')} />
  return (
    <View style={{ gap: 8 }}>
      {data.users.map((u) => (
        <View key={u.userId} style={styles.row}>
          <AvatarCircle url={u.avatarUrl} displayName={u.displayName} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{u.displayName}</Text>
            <Text style={styles.handle}>@{u.username}</Text>
          </View>
          {u.isMutual && <MutualBadge />}
          <TouchableOpacity style={styles.dangerBtn} onPress={() => unfollow.mutate(u.userId)}>
            <Text style={styles.dangerBtnText}>{t('friends.unfollow')}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )
}

function FollowersTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['followers'],
    queryFn: () => api.get<{ users: FollowerEntry[]; count: number }>('/v1/users/me/followers'),
    staleTime: 30_000,
  })
  const follow = useMutation({
    mutationFn: (id: string) => api.post(`/v1/users/${id}/follow`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['followers'] }); void qc.invalidateQueries({ queryKey: ['friends'] }) },
  })
  if (isLoading) return <LoadingSkeleton />
  if (!data?.users.length) return <EmptyState message={t('friends.noFollowers')} />
  return (
    <View style={{ gap: 8 }}>
      {data.users.map((u) => (
        <View key={u.userId} style={styles.row}>
          <AvatarCircle url={u.avatarUrl} displayName={u.displayName} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{u.displayName}</Text>
            <Text style={styles.handle}>@{u.username}</Text>
          </View>
          {u.isFollowingBack ? (
            <MutualBadge />
          ) : (
            <TouchableOpacity style={styles.accentBtn} onPress={() => follow.mutate(u.userId)}>
              <Text style={styles.accentBtnText}>{t('friends.followBack')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  )
}

function SearchTab({ search, setSearch }: { search: string; setSearch: (s: string) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['user-search', search],
    queryFn: () => api.get<{ users: SearchEntry[] }>(`/v1/users/search?q=${encodeURIComponent(search)}`),
    enabled: search.length >= 2,
    staleTime: 10_000,
  })
  const followMut = useMutation({
    mutationFn: (id: string) => api.post(`/v1/users/${id}/follow`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['user-search'] }),
  })
  const unfollowMut = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/users/${id}/follow`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['user-search'] }),
  })

  return (
    <View style={{ gap: 12 }}>
      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder={t('friends.searchPlaceholder')}
        placeholderTextColor={colors.textMuted}
        autoFocus
      />
      {isLoading && search.length >= 2 && <LoadingSkeleton count={3} />}
      {data?.users?.map((u) => (
        <View key={u.userId} style={styles.row}>
          <AvatarCircle url={u.avatarUrl} displayName={u.displayName} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{u.displayName}</Text>
            <Text style={styles.handle}>@{u.username}</Text>
          </View>
          <NativeTierBadge tier={u.tier} />
          {u.isMutual ? (
            <MutualBadge />
          ) : u.isFollowing ? (
            <TouchableOpacity style={styles.outlineBtn} onPress={() => unfollowMut.mutate(u.userId)}>
              <Text style={styles.outlineBtnText}>{t('friends.following')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.accentBtn} onPress={() => followMut.mutate(u.userId)}>
              <Text style={styles.accentBtnText}>{t('friends.follow')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {search.length >= 2 && !isLoading && data?.users?.length === 0 && (
        <EmptyState message={t('friends.noResults')} />
      )}
      {search.length < 2 && (
        <Text style={styles.mutedSmall}>{t('friends.searchHint')}</Text>
      )}
    </View>
  )
}

function MutualBadge() {
  const { t } = useTranslation()
  return (
    <View style={styles.mutualBadge}>
      <Text style={styles.mutualBadgeText}>{t('friends.mutual')}</Text>
    </View>
  )
}

function UserRow({ user, badge }: { user: FriendEntry; badge?: string }) {
  return (
    <View style={styles.row}>
      <AvatarCircle url={user.avatarUrl} displayName={user.displayName} size={32} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{user.displayName}</Text>
        <Text style={styles.handle}>@{user.username}</Text>
      </View>
      <NativeTierBadge tier={user.tier} />
      {badge && <MutualBadge />}
    </View>
  )
}

function LoadingSkeleton({ count = 5 }: { count?: number }) {
  return <View style={{ gap: 8 }}>{Array.from({ length: count }).map((_, i) => <SkeletonBox key={i} height={56} />)}</View>
}

function EmptyState({ message }: { message: string }) {
  return <Text style={styles.emptyText}>{message}</Text>
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16, gap: 12 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 20, marginBottom: 4 },
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 4,
    marginBottom: 4,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: 'center' },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  tabTextActive: { color: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  name: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  handle: { color: colors.textMuted, fontSize: 12 },
  mutualBadge: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  mutualBadgeText: { color: colors.success, fontSize: 10 },
  accentBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  accentBtnText: { color: '#fff', fontSize: 12 },
  dangerBtn: {
    borderColor: 'rgba(239,68,68,0.3)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dangerBtnText: { color: colors.danger, fontSize: 12 },
  outlineBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  outlineBtnText: { color: colors.textSecondary, fontSize: 12 },
  searchInput: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  mutedSmall: { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 16 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
})
