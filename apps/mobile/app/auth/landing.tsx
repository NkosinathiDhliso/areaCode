import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { colors } from '../../src/theme'

export default function AuthLanding() {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <View style={styles.container}>
      <Text style={styles.appName}>{t('app.name')}</Text>
      <Text style={styles.subtitle}>{t('auth.landing.subtitle')}</Text>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/auth/signup')}
        >
          <Text style={styles.primaryButtonText}>{t('auth.landing.customer')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {/* Business login — handled by business app */}}
        >
          <Text style={styles.secondaryButtonText}>{t('auth.landing.business')}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => router.push('/auth/login')}>
        <Text style={styles.link}>{t('auth.landing.hasAccount')}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.replace('/')}>
        <Text style={styles.mutedLink}>{t('auth.landing.browseOnly')}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  appName: { color: colors.textPrimary, fontWeight: '700', fontSize: 30, marginBottom: 8 },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginBottom: 48 },
  buttons: { width: '100%', maxWidth: 320, gap: 12 },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.textPrimary, fontSize: 16 },
  link: { color: colors.accent, fontSize: 14, marginTop: 24 },
  mutedLink: { color: colors.textMuted, fontSize: 12, marginTop: 16 },
})
