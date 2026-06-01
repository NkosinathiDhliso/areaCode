import { api } from '@area-code/shared/lib/api'
import type { PrivacyLevel, Tier } from '@area-code/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'

import { AvatarCircle } from '../src/components/AvatarCircle'
import { NativeTierBadge } from '../src/components/NativeTierBadge'
import { SkeletonBox } from '../src/components/Skeleton'
import { colors } from '../src/theme'

interface BlockedUser {
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  tier: Tier
  blockedAt: string
}

const PRIVACY_OPTIONS: { level: PrivacyLevel; titleKey: string; descKey: string; recommended?: boolean }[] = [
  { level: 'public', titleKey: 'privacy.level.public', descKey: 'privacy.level.publicDesc' },
  {
    level: 'friends_only',
    titleKey: 'privacy.level.friendsOnly',
    descKey: 'privacy.level.friendsOnlyDesc',
    recommended: true,
  },
  { level: 'private', titleKey: 'privacy.level.private', descKey: 'privacy.level.privateDesc' },
]

function PrivacyPicker() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<PrivacyLevel>('friends_only')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ privacyLevel: PrivacyLevel }>('/v1/users/me/privacy')
      .then((res) => {
        if (!cancelled) setSelected(res.privacyLevel)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSelect(level: PrivacyLevel) {
    if (level === selected || saving) return
    const previous = selected
    setSelected(level)
    setSaving(true)
    try {
      await api.patch('/v1/users/me/privacy', { privacyLevel: level })
    } catch {
      setSelected(previous)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.sectionLabel}>{t('privacy.settings.title')}</Text>
      {PRIVACY_OPTIONS.map((option) => {
        const isSelected = selected === option.level
        return (
          <TouchableOpacity
            key={option.level}
            onPress={() => void handleSelect(option.level)}
            disabled={loading || saving}
            style={[styles.option, isSelected && styles.optionSelected, (loading || saving) && styles.dim]}
          >
            <View style={[styles.radio, isSelected && styles.radioSelected]}>
              {isSelected && <View style={styles.radioDot} />}
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.optionTitleRow}>
                <Text style={styles.optionTitle}>{t(option.titleKey)}</Text>
                {option.recommended && (
                  <View style={styles.recommendedBadge}>
                    <Text style={styles.recommendedText}>{t('privacy.recommended')}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.optionDesc}>{t(option.descKey)}</Text>
            </View>
            {saving && isSelected && <ActivityIndicator size="small" color={colors.accent} />}
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export default function PrivacySettingsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['blocked-users'],
    queryFn: () => api.get<{ blocked: BlockedUser[] }>('/v1/users/me/blocks'),
    staleTime: 30_000,
  })

  const [unblocking, setUnblocking] = useState<string | null>(null)

  async function handleUnblock(userId: string) {
    setUnblocking(userId)
    try {
      await api.delete(`/v1/users/me/block/${userId}`)
      queryClient.setQueryData<{ blocked: BlockedUser[] }>(['blocked-users'], (old) =>
        old ? { blocked: old.blocked.filter((u) => u.userId !== userId) } : old,
      )
    } catch {
      // silent
    } finally {
      setUnblocking(null)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('privacy.settings.heading')}</Text>
      </View>

      <PrivacyPicker />

      <View style={styles.blockedSection}>
        <Text style={styles.sectionLabel}>{t('privacy.blockedUsers.title')}</Text>
        {isLoading ? (
          <View style={{ gap: 8 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBox key={i} height={56} />
            ))}
          </View>
        ) : !data?.blocked || data.blocked.length === 0 ? (
          <Text style={styles.emptyText}>{t('privacy.blockedUsers.empty')}</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {data.blocked.map((user) => (
              <View key={user.userId} style={styles.blockedRow}>
                <AvatarCircle url={user.avatarUrl} displayName={user.displayName} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{user.displayName}</Text>
                  <Text style={styles.handle}>@{user.username}</Text>
                </View>
                <NativeTierBadge tier={user.tier} />
                <TouchableOpacity
                  style={styles.unblockButton}
                  onPress={() => void handleUnblock(user.userId)}
                  disabled={unblocking === user.userId}
                >
                  <Text style={styles.unblockText}>
                    {unblocking === user.userId ? t('privacy.block.unblocking') : t('privacy.block.unblock')}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  backButton: { paddingRight: 4 },
  backText: { color: colors.textMuted, fontSize: 28, lineHeight: 28 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 18 },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.bgRaised },
  dim: { opacity: 0.6 },
  radio: {
    marginTop: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  optionDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  recommendedBadge: {
    backgroundColor: 'rgba(119,140,169,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  recommendedText: { color: colors.accent, fontSize: 10, fontWeight: '500' },
  blockedSection: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bgRaised,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  name: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  handle: { color: colors.textMuted, fontSize: 12 },
  unblockButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  unblockText: { color: colors.textSecondary, fontSize: 12 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 16 },
})
