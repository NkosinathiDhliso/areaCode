import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { SA_CITIES } from '@area-code/shared/constants/sa-cities'
import { colors } from '../../src/theme'

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) return `+27${digits.slice(1)}`
  if (digits.startsWith('27') && digits.length === 11) return `+${digits}`
  return raw.startsWith('+') ? raw : `+${digits}`
}

export default function ConsumerSignup() {
  const { t } = useTranslation()
  const router = useRouter()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)

  const [phone, setPhone] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [citySlug, setCitySlug] = useState('johannesburg')
  const [consentAnalytics, setConsentAnalytics] = useState(false)
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignup() {
    setLoading(true)
    setError(null)
    try {
      await api.post('/v1/auth/consumer/signup', {
        phone: toE164(phone),
        username,
        displayName,
        citySlug,
        consentAnalytics,
      })
      setStep('otp')
    } catch (err) {
      const apiErr = err as { message?: string }
      setError(apiErr.message ?? t('auth.signup.failed'))
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

  if (step === 'otp') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t('auth.signup.verifyTitle')}</Text>
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
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    )
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgBase }}
      contentContainerStyle={styles.scrollContent}
    >
      <Text style={styles.title}>{t('auth.signup.title')}</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder={t('auth.signup.phone')}
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
        />
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          placeholder={t('auth.signup.username')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('auth.signup.displayName')}
          placeholderTextColor={colors.textMuted}
        />

        {/* City selector — simple text buttons for SA cities */}
        <View style={styles.cityRow}>
          {SA_CITIES.slice(0, 4).map((city) => (
            <TouchableOpacity
              key={city.slug}
              style={[styles.cityChip, citySlug === city.slug && styles.cityChipActive]}
              onPress={() => setCitySlug(city.slug)}
            >
              <Text
                style={[styles.cityChipText, citySlug === city.slug && styles.cityChipTextActive]}
              >
                {city.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.consentRow}>
          <Switch
            value={consentAnalytics}
            onValueChange={setConsentAnalytics}
            trackColor={{ false: colors.bgRaised, true: colors.accent }}
          />
          <Text style={styles.consentText}>{t('auth.signup.consentAnalytics')}</Text>
        </View>

        <Text style={styles.privacyNote}>{t('profile.privacyExplainer')}</Text>

        <TouchableOpacity
          style={[styles.primaryButton, (!phone || !username || !displayName || loading) && styles.disabled]}
          onPress={handleSignup}
          disabled={loading || !phone || !username || !displayName}
        >
          <Text style={styles.primaryButtonText}>
            {loading ? '...' : t('auth.signup.submit')}
          </Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity onPress={() => router.push('/auth/login')}>
        <Text style={styles.link}>{t('auth.signup.hasAccount')}</Text>
      </TouchableOpacity>
    </ScrollView>
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
  scrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    minHeight: '100%',
  },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 24, marginBottom: 24 },
  form: { width: '100%', maxWidth: 320, gap: 12 },
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
  cityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityChip: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cityChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  cityChipText: { color: colors.textSecondary, fontSize: 13 },
  cityChipTextActive: { color: '#fff' },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  consentText: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  privacyNote: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 12, marginTop: 12 },
  link: { color: colors.accent, fontSize: 14, marginTop: 16 },
})
