import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'

import { signInWithGoogleConsumerMobile } from '../../src/lib/consumerGoogleOAuth'
import { colors } from '../../src/theme'

export default function ConsumerSignup() {
  const { t } = useTranslation()
  const router = useRouter()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showTokenField, setShowTokenField] = useState(false)
  const [firstGetToken, setFirstGetToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function maybeRedeemFirstGetToken() {
    const token = firstGetToken.trim().toUpperCase()
    if (!token) return
    try {
      await api.post('/v1/users/me/redeem-guest-token', { token })
    } catch {
      setError(t('auth.signup.tokenInvalid', "Couldn't apply that code, but your account is ready."))
    }
  }

  async function handleEmailSignup() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        user: { id: string }
      }>('/v1/auth/consumer/email-signup', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.user.id)
      await maybeRedeemFirstGetToken()
      router.replace('/')
    } catch {
      setError(t('auth.signup.emailFailed', 'Could not create your account. Check your details.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError(null)
    try {
      const res = await signInWithGoogleConsumerMobile()
      setAuth(res.accessToken, res.refreshToken, res.userId)
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgBase }} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>{t('auth.signup.title')}</Text>
      <Text style={styles.explainer}>{t('auth.signup.googleExplainer')}</Text>

      <View style={styles.form}>
        <TouchableOpacity
          style={[styles.googleButton, busy && styles.disabled]}
          onPress={() => void handleGoogle()}
          disabled={busy}
        >
          {googleLoading ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : (
            <Text style={styles.googleButtonText}>{t('auth.signup.continueGoogle')}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.divider}>{t('auth.signup.orEmail', 'or create an email account')}</Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.signup.email', 'Email')}
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
          placeholder={t('auth.signup.password', 'Password')}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          editable={!busy}
        />
        <Text style={[styles.hint, password.length > 0 && password.length < 8 && styles.warning]}>
          {password.length > 0 && password.length < 8
            ? t('auth.signup.passwordTooShort', 'Password must be at least 8 characters')
            : t('auth.signup.passwordHint', 'Minimum 8 characters')}
        </Text>

        {!showTokenField ? (
          <TouchableOpacity onPress={() => setShowTokenField(true)}>
            <Text style={styles.tokenToggle}>{t('auth.signup.haveToken', 'Got a code from a venue?')}</Text>
          </TouchableOpacity>
        ) : (
          <TextInput
            style={[styles.input, styles.tokenInput]}
            value={firstGetToken}
            onChangeText={(v) => setFirstGetToken(v.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, ''))}
            maxLength={8}
            placeholder={t('auth.signup.tokenPlaceholder', 'First-Get code (8 chars)')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />
        )}

        <TouchableOpacity
          style={[styles.submitButton, (!canSubmit || busy) && styles.disabled]}
          onPress={() => void handleEmailSignup()}
          disabled={!canSubmit || busy}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{t('auth.signup.submitEmail', 'Create account')}</Text>
          )}
        </TouchableOpacity>
      </View>

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
    marginBottom: 24,
    maxWidth: 320,
    lineHeight: 20,
  },
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
  tokenInput: { letterSpacing: 4, textAlign: 'center' },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: -4 },
  warning: { color: colors.warning },
  tokenToggle: { color: colors.textMuted, fontSize: 12, textDecorationLine: 'underline', textAlign: 'center' },
  submitButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 12, marginTop: 16, textAlign: 'center' },
  privacyNote: { color: colors.textMuted, fontSize: 12, marginTop: 24, textAlign: 'center', maxWidth: 320 },
  link: { color: colors.accent, fontSize: 14, marginTop: 20 },
})
