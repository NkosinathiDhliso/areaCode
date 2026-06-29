import { TIER_PERMANENCE_SHORT } from '@area-code/shared/constants/legal'
import { TIER_LEVELS } from '@area-code/shared/constants/tier-levels'
import type { TierLevel } from '@area-code/shared/constants/tier-levels'
import { api } from '@area-code/shared/lib/api'
import { useUnclaimedRewards } from '@area-code/shared/hooks'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import type { User } from '@area-code/shared/types'
import type { Tier } from '@area-code/shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native'

import { ArchetypeReveal } from '../../src/components/ArchetypeReveal'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { NativeTierBadge } from '../../src/components/NativeTierBadge'
import { RedemptionCodeCard } from '../../src/components/RedemptionCodeCard'
import { colors } from '../../src/theme'

export default function ProfileScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isAuthenticated, logout } = useConsumerAuthStore()
  const { user, tier, totalCheckIns, streakCount, setUser } = useUserStore()
  // Wallet of earned-but-unredeemed get codes. Lives in Profile now that the
  // standalone gets tab is gone; it is utility (a code to show staff), not a
  // discovery surface.
  const { rewards: earnedCodes } = useUnclaimedRewards()
  const [busy, setBusy] = useState(false)

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['check-in-history'] })
    },
  })

  interface TierProgressData {
    currentTier: Tier
    nextTier: Tier | null
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

  function handleLogout() {
    void api.post('/v1/auth/logout', {}).catch(() => {})
    logout()
    router.replace('/')
  }

  // POPIA full-data export. RN has no file download, so we share the JSON
  // payload via the native share sheet (save to Files, email, etc.).
  async function handleDataExport() {
    setBusy(true)
    try {
      const data = await api.get<Record<string, unknown>>('/v1/users/me/data-export')
      await Share.share({
        title: 'Area Code data export',
        message: JSON.stringify(data, null, 2),
      })
    } catch {
      Alert.alert(t('profile.exportFailed', "Couldn't download your data. Try again."))
    } finally {
      setBusy(false)
    }
  }

  function confirmDeleteHistory() {
    Alert.alert(
      t('profile.deleteHistoryConfirmTitle', 'Delete check-in history?'),
      t(
        'profile.deleteHistoryConfirmBody',
        'This will permanently delete all your check-in history. This action cannot be undone.',
      ),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { text: t('profile.deleteHistory'), style: 'destructive', onPress: () => deleteHistoryMutation.mutate() },
      ],
    )
  }

  function confirmDeleteAccount() {
    Alert.alert(
      t('profile.deleteAccountTitle', 'Delete your account?'),
      t(
        'profile.deleteAccountBody',
        'This will permanently delete your account, check-in history, rewards, and all associated data. This action cannot be undone.',
      ),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('profile.deleteAccountConfirm', 'Delete account'),
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            void api
              .delete('/v1/users/me')
              .then(() => {
                logout()
                router.replace('/')
              })
              .catch(() => setBusy(false))
          },
        },
      ],
    )
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
        <AvatarCircle url={displayUser?.avatarUrl ?? null} displayName={displayUser?.displayName ?? ''} size={56} />
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

      {tierProgress && (
        <View style={styles.tierProgressContainer}>
          <View style={styles.tierProgressHeader}>
            <Text style={styles.tierProgressLabel}>{tierProgress.currentTier}</Text>
            {tierProgress.nextTier && <Text style={styles.tierProgressNext}>→ {tierProgress.nextTier}</Text>}
          </View>
          <View style={styles.tierProgressTrack}>
            <View
              style={[
                styles.tierProgressFill,
                {
                  width: tierProgress.nextTierThreshold
                    ? `${Math.min(100, ((tierProgress.currentCheckIns - (TIER_LEVELS.find((l: TierLevel) => l.tier === tierProgress.currentTier)?.minCheckIns ?? 0)) / (tierProgress.nextTierThreshold - (TIER_LEVELS.find((l: TierLevel) => l.tier === tierProgress.currentTier)?.minCheckIns ?? 0))) * 100)}%`
                    : '100%',
                  backgroundColor:
                    TIER_LEVELS.find((l: TierLevel) => l.tier === tierProgress.currentTier)?.colour ?? colors.accent,
                },
              ]}
            />
          </View>
          <View style={styles.tierProgressFooter}>
            <Text style={styles.tierProgressCount}>{tierProgress.currentCheckIns} check-ins</Text>
            {tierProgress.checkInsRemaining > 0 ? (
              <Text style={styles.tierProgressRemaining}>
                {tierProgress.checkInsRemaining} more to {tierProgress.nextTier}
              </Text>
            ) : (
              <Text style={styles.tierProgressRemaining}>Max tier</Text>
            )}
          </View>
        </View>
      )}

      <Text style={styles.tierPermanence}>{TIER_PERMANENCE_SHORT}</Text>

      {earnedCodes.length > 0 && (
        <View style={styles.walletSection}>
          <Text style={styles.walletTitle}>{t('rewards.yourCodes')}</Text>
          <Text style={styles.walletHint}>{t('rewards.yourCodesHint')}</Text>
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
        </View>
      )}

      <ArchetypeReveal archetypeId={displayUser?.archetypeId ?? 'archetype-uncharted'} />

      <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/friends')}>
        <Text style={styles.menuText}>{t('friends.title')}</Text>
        <Text style={styles.menuArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/history')}>
        <Text style={styles.menuText}>{t('profile.checkInHistory', 'Check-in History')}</Text>
        <Text style={styles.menuArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/privacy')}>
        <Text style={styles.menuText}>{t('privacy.settings.link')}</Text>
        <Text style={styles.menuArrow}>→</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.privacy')}</Text>
        <Text style={styles.sectionBody}>{t('profile.privacyExplainer')}</Text>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.actionRow} onPress={() => void handleDataExport()} disabled={busy}>
          <Text style={styles.menuText}>{t('profile.downloadData', 'Download my data')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionRow}
          onPress={confirmDeleteHistory}
          disabled={deleteHistoryMutation.isPending}
        >
          <Text style={styles.dangerText}>{t('profile.deleteHistory')}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>{t('auth.gated.signOut')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteAccountButton} onPress={confirmDeleteAccount} disabled={busy}>
        <Text style={styles.dangerText}>{t('profile.deleteAccount', 'Delete my account')}</Text>
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
  tierPermanence: { color: colors.textMuted, fontSize: 12, marginTop: -4, marginBottom: 4 },
  walletSection: { gap: 12, marginBottom: 4 },
  walletTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  walletHint: { color: colors.textMuted, fontSize: 12, marginTop: -8 },
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
  deleteAccountButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  tierProgressContainer: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 4,
  },
  tierProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tierProgressLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  tierProgressNext: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tierProgressTrack: {
    height: 8,
    backgroundColor: colors.bgRaised,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  tierProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  tierProgressFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tierProgressCount: {
    color: colors.textMuted,
    fontSize: 11,
  },
  tierProgressRemaining: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
})
