import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { colors } from '../../src/theme'
import { signInWithGoogleConsumerMobile } from '../../src/lib/consumerGoogleOAuth'

export default function ConsumerLogin() {
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
    <View style={styles.container}>
      <Text style={styles.title}>{t('auth.login.title')}</Text>

      <TouchableOpacity
        style={[styles.googleButton, loading && styles.disabled]}
        onPress={() => void handleGoogle()}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <Text style={styles.googleButtonText}>{t('auth.login.continueGoogle')}</Text>
        )}
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity onPress={() => router.push('/auth/signup')}>
        <Text style={styles.link}>{t('auth.login.noAccount')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.replace('/')}>
        <Text style={styles.mutedLink}>{t('auth.login.browseOnly')}</Text>
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
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 24, marginBottom: 32 },
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
  link: { color: colors.accent, fontSize: 14, marginTop: 24 },
  mutedLink: { color: colors.textMuted, fontSize: 12, marginTop: 12 },
})
