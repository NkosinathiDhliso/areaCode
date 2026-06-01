import { api, type ApiError } from '@area-code/shared/lib/api'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'

import { colors } from '../../src/theme'

type Phase = 'email' | 'code' | 'success'

export default function ForgotPassword() {
  const { t } = useTranslation()
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRequestCode() {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/v1/auth/forgot-password', { email: email.trim() })
      setPhase('code')
    } catch {
      setError(t('auth.forgotError', 'Something went wrong. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    if (!code.trim() || !newPassword.trim()) return
    if (newPassword.length < 8) {
      setError(t('auth.signup.passwordTooShort', 'Password must be at least 8 characters'))
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/v1/auth/reset-password', { email: email.trim(), code: code.trim(), newPassword })
      setPhase('success')
    } catch (err) {
      const apiErr = err as ApiError
      setError(apiErr.message ?? t('auth.resetInvalid', 'Invalid or expired code. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.title}>
          {phase === 'success' ? t('auth.resetSuccess', 'Password reset') : t('auth.forgotPassword', 'Forgot password')}
        </Text>

        {phase === 'email' && (
          <>
            <Text style={styles.subtitle}>
              {t('auth.forgotHint', "Enter your email and we'll send you a reset code.")}
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.login.email', 'Email')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            {error.length > 0 && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity
              style={[styles.button, (loading || !email.trim()) && styles.disabled]}
              onPress={() => void handleRequestCode()}
              disabled={loading || !email.trim()}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t('auth.sendCode', 'Send reset code')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {phase === 'code' && (
          <>
            <Text style={styles.subtitle}>{t('auth.codeHint', 'Check your email for a 6-digit code.')}</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('auth.codePlaceholder', '6-digit code')}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              editable={!loading}
            />
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={t('auth.newPassword', 'New password (min 8 characters)')}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              editable={!loading}
            />
            {error.length > 0 && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity
              style={[styles.button, (loading || code.length !== 6 || newPassword.length < 8) && styles.disabled]}
              onPress={() => void handleResetPassword()}
              disabled={loading || code.length !== 6 || newPassword.length < 8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t('auth.resetPassword', 'Reset password')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {phase === 'success' && (
          <>
            <Text style={styles.subtitle}>
              {t('auth.resetDone', 'Your password has been reset. You can now sign in.')}
            </Text>
            <TouchableOpacity style={styles.button} onPress={() => router.replace('/auth/login')}>
              <Text style={styles.buttonText}>{t('auth.backToLogin', 'Back to sign in')}</Text>
            </TouchableOpacity>
          </>
        )}

        {phase !== 'success' && (
          <TouchableOpacity onPress={() => router.replace('/auth/login')}>
            <Text style={styles.mutedLink}>{t('auth.backToLogin', 'Back to sign in')}</Text>
          </TouchableOpacity>
        )}
      </View>
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
  form: { width: '100%', maxWidth: 320, gap: 12 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 22, textAlign: 'center', marginBottom: 8 },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
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
  codeInput: { textAlign: 'center', letterSpacing: 6 },
  button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  mutedLink: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4 },
})
