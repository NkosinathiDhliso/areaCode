import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { colors } from '../../src/theme'

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) return `+27${digits.slice(1)}`
  if (digits.startsWith('27') && digits.length === 11) return `+${digits}`
  return raw.startsWith('+') ? raw : `+${digits}`
}

export default function ConsumerLogin() {
  const { t } = useTranslation()
  const router = useRouter()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)

  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSendOtp() {
    setLoading(true)
    setError(null)
    try {
      await api.post('/v1/auth/consumer/login', { phone: toE164(phone) })
      setStep('otp')
    } catch {
      setError(t('auth.login.sendFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string; refreshToken: string; user: { id: string }
      }>('/v1/auth/consumer/verify-otp', { phone: toE164(phone), code: otp })
      setAuth(res.accessToken, res.refreshToken, res.user.id)
      router.replace('/')
    } catch {
      setError(t('auth.login.otpFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('auth.login.title')}</Text>

      {step === 'phone' ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('auth.login.phone')}
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            autoFocus
          />
          <TouchableOpacity
            style={[styles.primaryButton, (!phone || loading) && styles.disabled]}
            onPress={handleSendOtp}
            disabled={loading || !phone}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? '...' : t('auth.login.sendOtp')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
          <TextInput
            style={[styles.input, styles.otpInput]}
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
            placeholder={t('auth.login.otpPlaceholder')}
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.primaryButton, (otp.length !== 6 || loading) && styles.disabled]}
            onPress={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? '...' : t('auth.login.verifyOtp')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

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
  form: { width: '100%', maxWidth: 320, gap: 16 },
  input: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  otpInput: { textAlign: 'center', fontSize: 24, letterSpacing: 8 },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 12, marginTop: 12 },
  link: { color: colors.accent, fontSize: 14, marginTop: 24 },
  mutedLink: { color: colors.textMuted, fontSize: 12, marginTop: 12 },
})
