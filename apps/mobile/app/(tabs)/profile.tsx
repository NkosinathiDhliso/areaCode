import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import type { User } from '@area-code/shared/types'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { NativeTierBadge } from '../../src/components/NativeTierBadge'
import { colors } from '../../src/theme'

export default function ProfileScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { isAuthenticated, logout } = useConsumerAuthStore()
  const { user, tier, totalCheckIns, streakCount, setUser } = useUserStore()

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
  })

  function handleLogout() {
    void api.post('/v1/auth/logout', {}).catch(() => {})
    logout()
    router.replace('/')
  }

  const displayUser = profile ?? user

  if (!displayUser && !isAuthenticated) {
    return (
      <View style={styles.centered}>
        <Text style={styles.gatedText}>{t('auth.gated.signIn')}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/auth/login')}>
          <Text style={styles.primaryButtonText}>{t('auth.gated.signInButton')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <AvatarCircle
          url={displayUser?.avatarUrl ?? null}
          displayName={displayUser?.displayName ?? ''}
          size={56}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.displayName}>{displayUser?.displayName}</Text>
          <Text style={styles.username}>@{displayUser?.username}</Text>
        </View>
        <NativeTierBadge tier={tier} />
      </View>

      <View style={styles.statsRow}>
        <StatCard value={String(totalCheckIns)} label={t('profile.totalCheckIns')} />
        <StatCard value={String(streakCount)} label={t('profile.currentStreak')} />
        <StatCard value={tier} label={t('profile.currentTier')} />
      </View>

      <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/friends')}>
        <Text style={styles.menuText}>{t('friends.title')}</Text>
        <Text style={styles.menuArrow}>→</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.privacy')}</Text>
        <Text style={styles.sectionBody}>{t('profile.privacyExplainer')}</Text>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.actionRow}>
          <Text style={styles.menuText}>{t('profile.exportHistory')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => deleteHistoryMutation.mutate()}
          disabled={deleteHistoryMutation.isPending}
        >
          <Text style={styles.dangerText}>{t('profile.deleteHistory')}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>{t('auth.gated.signOut')}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, gap: 16 },
  gatedText: { color: colors.textSecondary, fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 8 },
  displayName: { color: colors.textPrimary, fontWeight: '700', fontSize: 18 },
  username: { color: colors.textMuted, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  statCard: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  statValue: { color: colors.textPrimary, fontWeight: '700', fontSize: 20 },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuText: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  menuArrow: { color: colors.textMuted, fontSize: 14 },
  section: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  sectionBody: { color: colors.textSecondary, fontSize: 14 },
  actionRow: { paddingVertical: 8 },
  dangerText: { color: colors.danger, fontSize: 14 },
  logoutButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutText: { color: colors.textPrimary, fontSize: 14 },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
})
