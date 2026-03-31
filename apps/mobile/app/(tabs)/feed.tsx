import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import { formatRelativeTime } from '@area-code/shared/lib/formatters'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { SkeletonBox } from '../../src/components/Skeleton'
import { colors } from '../../src/theme'

interface FeedItem {
  id: string
  checkedInAt: string
  user: { id: string; username: string; displayName: string; avatarUrl: string | null; tier: string }
  node: { id: string; name: string; slug: string; category: string }
}

interface FeedResponse {
  items: FeedItem[]
  nextCursor: string | null
  hasMore: boolean
}

export default function FeedScreen() {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery({
    queryKey: ['feed'],
    queryFn: () => api.get<FeedResponse>('/v1/feed?limit=20'),
    staleTime: 30_000,
  })

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('feed.title')}</Text>

      {isLoading ? (
        Array.from({ length: 5 }).map((_, i) => <SkeletonBox key={i} height={64} />)
      ) : data?.items && data.items.length > 0 ? (
        data.items.map((item) => (
          <View key={item.id} style={styles.row}>
            <AvatarCircle
              url={item.user.avatarUrl}
              displayName={item.user.displayName}
              size={32}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.feedText}>
                <Text style={styles.bold}>{item.user.username}</Text>
                {' checked in to '}
                <Text style={styles.bold}>{item.node.name}</Text>
              </Text>
              <Text style={styles.time}>{formatRelativeTime(item.checkedInAt)}</Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>{t('feed.emptyState')}</Text>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16, gap: 12 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 20, marginBottom: 4 },
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
  feedText: { color: colors.textPrimary, fontSize: 14 },
  bold: { fontWeight: '500' },
  time: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
})
