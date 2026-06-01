import { useProximityNudge, type VisitedNode } from '@area-code/shared/hooks/useProximityNudge'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

import { colors } from '../theme'

interface VisitedResponse {
  items: VisitedNode[]
}

interface ProximityNudgeBannerProps {
  onCheckIn: (nodeId: string) => void
}

/**
 * Banner shown when the user arrives at a venue they've previously checked
 * into. Wires the shared `useProximityNudge` hook to the location store and
 * /v1/users/me/visited. Mirrors the web ProximityNudgeBanner (churn-defences
 * §1.4). Detection is fully client-side; coordinates never leave the device.
 */
export function ProximityNudgeBanner({ onCheckIn }: ProximityNudgeBannerProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const position = useLocationStore((s) => s.lastKnownPosition)
  const privacyLevel = useUserStore((s) => s.user?.privacyLevel ?? 'friends_only')
  const proximityEnabled = useUserStore((s) => s.user?.proximityNudgesEnabled ?? true)
  const [visited, setVisited] = useState<VisitedNode[]>([])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    const fetchVisited = () =>
      api
        .get<VisitedResponse>('/v1/users/me/visited')
        .then((res) => {
          if (!cancelled) setVisited(res.items ?? [])
        })
        .catch(() => {
          /* silent — proximity simply doesn't fire */
        })
    void fetchVisited()
    const id = setInterval(fetchVisited, 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [isAuthenticated])

  const enabled = isAuthenticated && privacyLevel !== 'private' && proximityEnabled
  const { current, dismiss } = useProximityNudge({ position, visited, enabled })

  if (!current) return null

  const venueName = current.node.name ?? 'this venue'

  return (
    <View style={styles.banner}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {t('proximity.atVenue', { defaultValue: "You're at {{venue}}", venue: venueName })}
        </Text>
        <Text style={styles.subtitle}>{t('proximity.keepStreak', 'Check in to keep your streak going.')}</Text>
      </View>
      <TouchableOpacity
        style={styles.checkInButton}
        onPress={() => {
          const nodeId = current.node.nodeId
          dismiss()
          onCheckIn(nodeId)
        }}
      >
        <Text style={styles.checkInText}>{t('checkin.button')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={dismiss} style={styles.dismissButton}>
        <Text style={styles.dismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgRaised,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  checkInButton: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  checkInText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  dismissButton: { paddingHorizontal: 4 },
  dismissText: { color: colors.textMuted, fontSize: 14 },
})
