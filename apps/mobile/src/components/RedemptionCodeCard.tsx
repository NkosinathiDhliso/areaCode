import { View, Text, StyleSheet } from 'react-native'

import { colors } from '../theme'

export interface RedemptionCodeCardProps {
  rewardTitle: string
  redemptionCode: string
  nodeName?: string
  codeExpiresAt?: string
  hint?: string
}

function formatExpiry(expiresAt?: string): string | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt) - Date.now()
  if (ms <= 0) return 'Missed'
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR
  if (ms < HOUR) return `Expires in ${Math.max(1, Math.round(ms / (60 * 1000)))}m`
  if (ms < DAY) return `Expires in ${Math.round(ms / HOUR)}h`
  return `Expires in ${Math.round(ms / DAY)}d`
}

/**
 * Native counterpart of the shared web RedemptionCodeCard. Displays an earned
 * reward's redemption code for the consumer to present to venue staff.
 */
export function RedemptionCodeCard({
  rewardTitle,
  redemptionCode,
  nodeName,
  codeExpiresAt,
  hint = 'Show this code to staff to claim your reward.',
}: RedemptionCodeCardProps) {
  const expiry = formatExpiry(codeExpiresAt)
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {rewardTitle}
          </Text>
          {nodeName ? (
            <Text style={styles.node} numberOfLines={1}>
              {nodeName}
            </Text>
          ) : null}
        </View>
        {expiry ? <Text style={styles.expiry}>{expiry}</Text> : null}
      </View>

      <View style={styles.codeBox}>
        <Text style={styles.code} selectable>
          {redemptionCode}
        </Text>
      </View>

      <Text style={styles.hint}>{hint}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  node: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  expiry: { color: colors.danger, fontSize: 11, fontWeight: '500' },
  codeBox: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: { color: colors.accentBright, fontSize: 30, fontWeight: '700', letterSpacing: 6 },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
})
