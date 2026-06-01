import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import { getArchetypeDisplayName } from '@area-code/shared/constants/archetype-names'
import { api } from '@area-code/shared/lib/api'
import type { CrowdVibeSnapshot, MusicGenre } from '@area-code/shared/types'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, StyleSheet } from 'react-native'

import { colors } from '../theme'

import { ArchetypeIcon } from './ArchetypeIcon'

interface CrowdVibeSectionProps {
  nodeId: string
}

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano',
  deep_house: 'Deep House',
  afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop',
  rnb: 'R&B',
  kwaito: 'Kwaito',
  gqom: 'Gqom',
  jazz: 'Jazz',
  rock: 'Rock',
  pop: 'Pop',
  gospel: 'Gospel',
  maskandi: 'Maskandi',
}

/**
 * Text-based crowd-vibe readout for the node detail sheet. Mirrors the web
 * CrowdVibeSection: shows archetype percentages and genre counts derived from
 * checked-in users' music data. Renders nothing when there's no data.
 */
export function CrowdVibeSection({ nodeId }: CrowdVibeSectionProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<CrowdVibeSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<CrowdVibeSnapshot>(`/v1/nodes/${nodeId}/crowd-vibe`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        /* hide silently */
      })
    return () => {
      cancelled = true
    }
  }, [nodeId])

  if (!data || data.totalCheckedIn === 0) return null

  const archetypeEntries = Object.entries(data.archetypePercentages)
    .filter(([, pct]) => pct > 0)
    .sort((a, b) => b[1] - a[1])

  const genreEntries = (
    Object.entries(data.genreCounts).filter(([, count]) => (count ?? 0) > 0) as [MusicGenre, number][]
  ).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))

  if (archetypeEntries.length === 0 && genreEntries.length === 0) return null

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('crowdVibe.title')}</Text>

      {archetypeEntries.length > 0 && (
        <View style={styles.chipRow}>
          {archetypeEntries.map(([name, pct]) => {
            const arch = ARCHETYPE_CATALOG.find((a) => a.name === name)
            const displayName = arch ? getArchetypeDisplayName(arch.id) : name
            return (
              <View key={name} style={styles.archetypeChip}>
                <ArchetypeIcon iconId={arch?.iconId} size={16} color={colors.textSecondary} />
                <Text style={styles.archetypePct}>{pct}%</Text>
                <Text style={styles.archetypeName}>{displayName}</Text>
              </View>
            )
          })}
        </View>
      )}

      {genreEntries.length > 0 && (
        <View style={styles.chipRow}>
          {genreEntries.map(([genre, count]) => (
            <View key={genre} style={styles.genreChip}>
              <Text style={styles.genreText}>
                {count} {GENRE_LABELS[genre] ?? genre}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: 16, gap: 8 },
  heading: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  archetypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  archetypePct: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  archetypeName: { color: colors.textSecondary, fontSize: 12 },
  genreChip: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  genreText: { color: colors.textSecondary, fontSize: 12 },
})
