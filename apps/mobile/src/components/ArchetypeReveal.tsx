import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import { getArchetypeDisplayName, getArchetypeEtymology } from '@area-code/shared/constants/archetype-names'
import { useTranslation } from 'react-i18next'
import { View, Text, StyleSheet } from 'react-native'

import { colors } from '../theme'

import { ArchetypeIcon } from './ArchetypeIcon'

const UNCHARTED_ARCHETYPE_ID = 'archetype-uncharted'

interface ArchetypeRevealProps {
  archetypeId: string
}

/**
 * Compact archetype card for the mobile profile. Mirrors the web
 * ArchetypeReveal: Phosphor icon + short display name + catalog description,
 * with an etymology line where one exists and the "uncharted" call to action.
 */
export function ArchetypeReveal({ archetypeId }: ArchetypeRevealProps) {
  const { t } = useTranslation()
  const archetype = ARCHETYPE_CATALOG.find((a) => a.id === archetypeId)
  const displayName = getArchetypeDisplayName(archetypeId)
  const etymology = getArchetypeEtymology(archetypeId)
  const isUncharted = archetypeId === UNCHARTED_ARCHETYPE_ID

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>{t('profile.archetype.title', 'Your Music Personality')}</Text>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <ArchetypeIcon iconId={archetype?.iconId ?? 'uncharted'} size={28} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{displayName}</Text>
          {etymology ? <Text style={styles.etymology}>{etymology}</Text> : null}
          {archetype?.description ? <Text style={styles.description}>{archetype.description}</Text> : null}
        </View>
      </View>
      {isUncharted && (
        <Text style={styles.uncharted}>
          {t(
            'profile.archetype.uncharted',
            'Connect a streaming service or pick your genres to discover your music personality.',
          )}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  etymology: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  description: { color: colors.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  uncharted: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
})
