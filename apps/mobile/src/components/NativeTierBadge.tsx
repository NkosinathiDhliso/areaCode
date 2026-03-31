import { View, Text, StyleSheet } from 'react-native'
import type { Tier } from '@area-code/shared/types'
import { colors } from '../theme'

interface NativeTierBadgeProps {
  tier: Tier
  compact?: boolean
}

const TIER_LABELS: Record<Tier, string> = {
  local: 'Local',
  regular: 'Regular',
  fixture: 'Fixture',
  institution: 'Institution',
  legend: 'Legend',
}

const TIER_COLORS: Record<Tier, string> = {
  local: colors.tierLocal,
  regular: colors.tierRegular,
  fixture: colors.tierFixture,
  institution: colors.tierInstitution,
  legend: colors.accent,
}

export function NativeTierBadge({ tier, compact }: NativeTierBadgeProps) {
  const color = TIER_COLORS[tier]

  if (compact) {
    return (
      <View style={[styles.dot, { backgroundColor: color }]} />
    )
  }

  return (
    <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
      <Text style={[styles.text, { color }]}>{TIER_LABELS[tier]}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2 },
  text: { fontSize: 12, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
