import { useState } from 'react'
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { NODE_CATEGORIES } from '@area-code/shared/constants/node-categories'
import type { NodeCategory } from '@area-code/shared/types'
import { colors } from '../theme'

interface CategoryFilterBarProps {
  onFilter: (category: NodeCategory | null) => void
}

export function CategoryFilterBar({ onFilter }: CategoryFilterBarProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState<NodeCategory | null>(null)

  function handleTap(category: NodeCategory) {
    const next = active === category ? null : category
    setActive(next)
    onFilter(next)
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {NODE_CATEGORIES.map((cat) => (
        <TouchableOpacity
          key={cat.value}
          onPress={() => handleTap(cat.value)}
          style={[styles.chip, active === cat.value && styles.chipActive]}
        >
          <Text style={[styles.chipText, active === cat.value && styles.chipTextActive]}>
            {t(`map.categories.${cat.value}`)}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  chip: {
    backgroundColor: 'rgba(18,18,24,0.85)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
})
