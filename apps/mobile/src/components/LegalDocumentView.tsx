import type { LegalDocument } from '@area-code/shared/constants/legal-content'
import { useRouter } from 'expo-router'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'

import { colors } from '../theme'

interface LegalDocumentViewProps {
  doc: LegalDocument
}

/** Renders a structured LegalDocument (privacy / terms) as scrollable text. */
export function LegalDocumentView({ doc }: LegalDocumentViewProps) {
  const router = useRouter()

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>‹ Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{doc.title}</Text>
      <Text style={styles.updated}>Last updated: {doc.lastUpdated}</Text>

      {doc.intro.map((para, i) => (
        <Text key={`intro-${i}`} style={styles.paragraph}>
          {para}
        </Text>
      ))}

      {doc.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.heading}>{section.heading}</Text>
          {section.body.map((para, i) => (
            <Text key={`${section.heading}-${i}`} style={para.startsWith('•') ? styles.bullet : styles.paragraph}>
              {para}
            </Text>
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 },
  backButton: { marginBottom: 16 },
  backText: { color: colors.textMuted, fontSize: 14 },
  title: { color: colors.textPrimary, fontWeight: '800', fontSize: 26, marginBottom: 4 },
  updated: { color: colors.textMuted, fontSize: 12, marginBottom: 20 },
  section: { marginTop: 16 },
  heading: { color: colors.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 8 },
  paragraph: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  bullet: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 6, paddingLeft: 8 },
})
