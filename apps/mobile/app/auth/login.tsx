import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'

import { signInWithGoogleConsumerMobile } from '../../src/lib/consumerGoogleOAuth'
import { colors } from '../../src/theme'

export default function ConsumerLogin() {
  const { t } = useTranslation()
  const router = useRouter()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmailLogin() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        sessionId?: string
        user: { id: string }
      }>('/v1/auth/consumer/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.user.id, res.sessionId)
      router.replace('/')
    } catch {
      setError(t('auth.login.emailFailed', 'Invalid email or password.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    try {
      const res = await signInWithGoogleConsumerMobile()
      setAuth(res.accessToken, res.refreshToken, res.userId, res.sessionId)
      router.replace(res.isNewUser ? '/auth/first-get' : '/')
    } catch {
      setError(t('auth.oauth.failed'))
    } finally {
      setGoogleLoading(false)
    }
  }

  const busy = loading || googleLoading
  const canSubmit = email.length > 0 && password.length >= 8

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('auth.login.title')}</Text>

      <View style={styles.form}>
        <TouchableOpacity
          style={[styles.googleButton, busy && styles.disabled]}
          onPress={() => void handleGoogle()}
          disabled={busy}
        >
          {googleLoading ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : (
            <Text style={styles.googleButtonText}>{t('auth.login.continueGoogle')}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.divider}>{t('auth.login.orEmail', 'or use email and password')}</Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.login.email', 'Email')}
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={t('auth.login.password', 'Password')}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          editable={!busy}
        />
        {password.length > 0 && password.length < 8 && (
          <Text style={styles.warning}>{t('auth.login.passwordShort', 'Password must be at least 8 characters')}</Text>
        )}

        <TouchableOpacity
          style={[styles.submitButton, (!canSubmit || busy) && styles.disabled]}
          onPress={() => void handleEmailLogin()}
          disabled={!canSubmit || busy}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{t('auth.login.submitEmail', 'Sign in')}</Text>
          )}
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity onPress={() => router.push('/auth/forgot-password')}>
        <Text style={styles.mutedLink}>{t('auth.login.forgotPassword', 'Forgot password?')}</Text>
      </TouchableOpacity>
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
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 24, marginBottom: 24 },
  form: { width: '100%', maxWidth: 320, gap: 12 },
  googleButton: {
    width: '100%',
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  googleButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 16 },
  divider: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  input: {
    width: '100%',
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  warning: { color: colors.warning, fontSize: 12, marginTop: -4 },
  submitButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 12, marginTop: 16, textAlign: 'center' },
  link: { color: colors.accent, fontSize: 14, marginTop: 20 },
  mutedLink: { color: colors.textMuted, fontSize: 12, marginTop: 12 },
})
