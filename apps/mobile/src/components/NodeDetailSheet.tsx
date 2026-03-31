import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Node } from '@area-code/shared/types'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { colors } from '../theme'

interface NodeDetailSheetProps {
  node: Node | null
  pulseScore: number
  isOpen: boolean
  onClose: () => void
  onCheckIn: () => void
}

function getNodeState(score: number): string {
  if (score >= 80) return 'popping'
  if (score >= 60) return 'buzzing'
  if (score >= 30) return 'active'
  if (score >= 10) return 'quiet'
  return 'dormant'
}

export function NodeDetailSheet({ node, pulseScore, isOpen, onClose, onCheckIn }: NodeDetailSheetProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)

  if (!node) return null

  const state = getNodeState(pulseScore)

  return (
    <Modal visible={isOpen} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView>
            <Text style={styles.name}>{node.name}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.category}>{node.category}</Text>
              <View style={[styles.stateDot, { backgroundColor: stateColor(state) }]} />
              <Text style={styles.stateText}>{state}</Text>
            </View>

            {isAuthenticated ? (
              <TouchableOpacity style={styles.checkInButton} onPress={onCheckIn}>
                <Text style={styles.checkInText}>{t('checkin.button')}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.gatedText}>{t('auth.signupSheet.title')}</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function stateColor(state: string): string {
  switch (state) {
    case 'popping': return '#ef4444'
    case 'buzzing': return '#f59e0b'
    case 'active': return '#10b981'
    case 'quiet': return '#6b7280'
    default: return '#374151'
  }
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bgOverlay },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 16,
  },
  name: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  category: { color: colors.textSecondary, fontSize: 13, textTransform: 'capitalize' },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  stateText: { color: colors.textSecondary, fontSize: 13, textTransform: 'capitalize' },
  checkInButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  checkInText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  gatedText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: 16 },
})
