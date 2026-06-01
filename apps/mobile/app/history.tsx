import { api } from '@area-code/shared/lib/api'
import { formatLocalDate, formatLocalTime } from '@area-code/shared/lib/formatters'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'

import { SkeletonBox } from '../src/components/Skeleton'
import { colors } from '../src/theme'

interface CheckInHistoryEntry {
  id: string
  nodeId: string
  checkedInAt: string
  node: { name: string; slug: string; category: string }
}

interface CheckInHistoryResponse {
  items: CheckInHistoryEntry[]
  nextCursor: string | null
  hasMore: boolean
}

export default function CheckInHistoryScreen() {
  const { t } = useTranslation()
  const router = useRouter()

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } = useInfiniteQuery({
    queryKey: ['check-in-history'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ limit: '20' })
      if (pageParam) params.set('cursor', pageParam)
      return api.get<CheckInHistoryResponse>(`/v1/users/me/check-in-history?${params.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  })

  const allItems = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.checkInHistory', 'Check-in History')}</Text>
      </View>

      {isLoading ? (
        <View style={styles.listContent}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBox key={i} height={64} />
          ))}
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t('errors.loadFailed', 'Failed to load. Please try again.')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void refetch()}>
            <Text style={styles.retryText}>{t('common.retry', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : allItems.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t('profile.noCheckIns', 'No check-ins yet. Go explore!')}</Text>
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
          }}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.nodeName} numberOfLines={1}>
                  {item.node.name}
                </Text>
                <Text style={styles.category}>{item.node.category}</Text>
              </View>
              <View style={styles.dateColumn}>
                <Text style={styles.date}>{formatLocalDate(item.checkedInAt)}</Text>
                <Text style={styles.time}>{formatLocalTime(item.checkedInAt)}</Text>
              </View>
            </View>
          )}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  backButton: { paddingHorizontal: 8, paddingVertical: 2 },
  backText: { color: colors.textMuted, fontSize: 28, lineHeight: 28 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 18 },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
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
  nodeName: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  category: { color: colors.textMuted, fontSize: 12, textTransform: 'capitalize', marginTop: 2 },
  dateColumn: { alignItems: 'flex-end' },
  date: { color: colors.textSecondary, fontSize: 12 },
  time: { color: colors.textMuted, fontSize: 12 },
  footer: { paddingVertical: 16, alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  retryButton: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
})
