import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import type { LeaderboardEntry, Tier } from '@area-code/shared/types'
import { SkeletonBox } from '../../src/components/Skeleton'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { NativeTierBadge } from '../../src/components/NativeTierBadge'
import { colors } from '../../src/theme'

interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  userRank: { rank: number; checkInCount: number } | null
}

export default function LeaderboardScreen() {
  const { t } = useTranslation()
  const citySlug = 'johannesburg'

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', citySlug],
    queryFn: () => api.get<LeaderboardResponse>(`/v1/leaderboard/${citySlug}`),
    staleTime: 30_000,
  })

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('leaderboard.title')}</Text>
      <Text style={styles.subtitle}>{t('leaderboard.thisWeek')}</Text>

      {isLoading ? (
        Array.from({ length: 10 }).map((_, i) => <SkeletonBox key={i} height={56} />)
      ) : data?.entries && data.entries.length > 0 ? (
        <>
          {data.entries.map((entry) => (
            <View key={entry.userId} style={styles.row}>
              <Text style={styles.rank}>{entry.rank}</Text>
              {entry.isFriend ? (
                <AvatarCircle
                  url={entry.avatarUrl}
                  displayName={entry.displayName ?? ''}
                  size={32}
                />
              ) : (
                <View style={styles.anonAvatar}>
                  <NativeTierBadge tier={entry.tier as Tier} compact />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {entry.isFriend ? entry.displayName : t('leaderboard.anonymousExplorer')}
                </Text>
              </View>
              <NativeTierBadge tier={entry.tier as Tier} />
              <Text style={styles.count}>{entry.checkInCount}</Text>
            </View>
          ))}

          {data.userRank && !data.entries.find((e) => e.rank === data.userRank?.rank) && (
            <>
              <View style={styles.divider} />
              <View style={[styles.row, styles.userRow]}>
                <Text style={[styles.rank, { color: colors.accent }]}>{data.userRank.rank}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{t('leaderboard.you')}</Text>
                </View>
                <Text style={styles.count}>{data.userRank.checkInCount}</Text>
              </View>
            </>
          )}
        </>
      ) : (
        <Text style={styles.empty}>{t('leaderboard.noData')}</Text>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16, gap: 8 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 20, marginBottom: 2 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginBottom: 12 },
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
  userRow: { backgroundColor: colors.bgRaised, borderColor: colors.accent },
  rank: { color: colors.textMuted, fontSize: 14, fontWeight: '500', width: 24, textAlign: 'right' },
  anonAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  count: { color: colors.textSecondary, fontSize: 14, fontWeight: '500', marginLeft: 8 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border, marginVertical: 8 },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
})
