import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { colors } from '../../src/theme'
import { signInWithGoogleConsumerMobile } from '../../src/lib/consumerGoogleOAuth'

export default function ConsumerSignup() {
  const { t } = useTranslation()
  const router = useRouter()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogle() {
    setLoading(true)
    setError(null)
    try {
      const res = await signInWithGoogleConsumerMobile()
      setAuth(res.accessToken, res.refreshToken, res.userId, res.sessionId)
      router.replace('/')
    } catch {
      setError(t('auth.oauth.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgBase }}
      contentContainerStyle={styles.scrollContent}
    >
      <Text style={styles.title}>{t('auth.signup.title')}</Text>
      <Text style={styles.explainer}>{t('auth.signup.googleExplainer')}</Text>

      <TouchableOpacity
        style={[styles.googleButton, loading && styles.disabled]}
        onPress={() => void handleGoogle()}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <Text style={styles.googleButtonText}>{t('auth.signup.continueGoogle')}</Text>
        )}
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.privacyNote}>{t('profile.privacyExplainer')}</Text>

      <TouchableOpacity onPress={() => router.push('/auth/login')}>
        <Text style={styles.link}>{t('auth.signup.hasAccount')}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    minHeight: '100%',
  },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 24, marginBottom: 12 },
  explainer: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
    maxWidth: 320,
    lineHeight: 20,
  },
  googleButton: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  googleButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 12, marginTop: 16, textAlign: 'center' },
  privacyNote: { color: colors.textMuted, fontSize: 12, marginTop: 28, textAlign: 'center', maxWidth: 320 },
  link: { color: colors.accent, fontSize: 14, marginTop: 24 },
})
