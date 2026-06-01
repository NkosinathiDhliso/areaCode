import { api } from '@area-code/shared/lib/api'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useUnclaimedRewards } from '@area-code/shared/hooks'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { View, Text, ScrollView, StyleSheet } from 'react-native'

import { SkeletonBox } from '../../src/components/Skeleton'
import { RedemptionCodeCard } from '../../src/components/RedemptionCodeCard'
import { colors } from '../../src/theme'

interface NearbyReward {
  id: string
  title: string
  type: string
  totalSlots: number | null
  claimedCount: number
  nodeName: string
  nodeSlug: string
  distance: number
  expiresAt: string | null
}

export default function RewardsScreen() {
  const { t } = useTranslation()
  const pos = useLocationStore((s) => s.lastKnownPosition)
  const connectivity = useConnectivityStore((s) => s.state)

  const { data: rewards, isLoading } = useQuery({
    queryKey: ['rewards', 'near-me', pos?.lat, pos?.lng],
    queryFn: () =>
      api.get<NearbyReward[]>(`/v1/rewards/near-me?lat=${pos?.lat ?? -26.2041}&lng=${pos?.lng ?? 28.0473}`),
    enabled: connectivity !== 'offline',
    staleTime: 30_000,
  })

  // Earned-but-unredeemed reward codes (the consumer's wallet).
  const { rewards: earnedCodes } = useUnclaimedRewards()

  if (connectivity === 'offline') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{t('rewards.unavailableOffline')}</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {earnedCodes.length > 0 && (
        <View style={styles.walletSection}>
          <Text style={styles.title}>{t('rewards.yourCodes')}</Text>
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

      <Text style={styles.title}>{t('rewards.nearYou')}</Text>

      {isLoading ? (
        <>
          <SkeletonBox height={80} />
          <SkeletonBox height={80} />
          <SkeletonBox height={80} />
        </>
      ) : rewards && rewards.length > 0 ? (
        rewards.map((r) => {
          const slotsLeft = r.totalSlots ? r.totalSlots - r.claimedCount : null
          const isLow = slotsLeft !== null && slotsLeft <= 5
          return (
            <View key={r.id} style={styles.card}>
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{r.title}</Text>
                  <Text style={styles.cardSub}>
                    {r.nodeName} · {Math.round(r.distance)}m away
                  </Text>
                </View>
                {slotsLeft !== null && (
                  <Text style={[styles.slots, isLow && styles.slotsLow]}>
                    {slotsLeft} {t('node.left')}
                  </Text>
                )}
              </View>
            </View>
          )
        })
      ) : (
        <Text style={styles.emptyText}>{t('rewards.noneNearby')}</Text>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16, gap: 12 },
  walletSection: { gap: 12, marginBottom: 12 },
  walletHint: { color: colors.textMuted, fontSize: 12, marginTop: -4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 20, marginBottom: 4 },
  card: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  cardSub: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  slots: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  slotsLow: { color: colors.danger },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
})
