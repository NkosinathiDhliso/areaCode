import { api } from '@area-code/shared/lib/api'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'

import { colors } from '../../src/theme'

/**
 * One-time post-signup prompt asking for a venue First-Get token.
 * Reached after a new-user Google signup. Mirrors the web FirstGetPrompt
 * (churn-defences spec, Requirement 6). Tokens are 8-char Crockford base32.
 */
export default function FirstGetPrompt() {
  const { t } = useTranslation()
  const router = useRouter()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function clean(input: string): string {
    return input.toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
  }

  async function handleSubmit() {
    const t8 = token.trim().toUpperCase()
    if (t8.length !== 8) {
      setError(t('auth.firstGet.tokenInvalid', 'Codes are exactly 8 characters.'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.post('/v1/users/me/redeem-guest-token', { token: t8 })
      router.replace('/')
    } catch {
      setError(t('auth.firstGet.tokenFailed', "Couldn't apply that code. Check it with the venue or skip for now."))
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.title}>{t('auth.firstGet.title', 'Got a code from a venue?')}</Text>
        <Text style={styles.subtitle}>
          {t(
            'auth.firstGet.subtitle',
            'If a venue gave you a one-time code at the till, enter it here. Otherwise, skip - you can still use the app normally.',
          )}
        </Text>

        <TextInput
          style={styles.input}
          value={token}
          onChangeText={(v) => setToken(clean(v))}
          maxLength={8}
          placeholder="ABCD1234"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.button, (loading || token.length !== 8) && styles.disabled]}
          onPress={() => void handleSubmit()}
          disabled={loading || token.length !== 8}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('auth.firstGet.submit', 'Apply code')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace('/')}>
          <Text style={styles.skip}>{t('auth.firstGet.skip', "Skip - I don't have a code")}</Text>
        </TouchableOpacity>

        {error && <Text style={styles.error}>{error}</Text>}
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
  form: { width: '100%', maxWidth: 340, gap: 16 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 20, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  input: {
    width: '100%',
    backgroundColor: colors.bgRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: colors.textPrimary,
    fontSize: 18,
    textAlign: 'center',
    letterSpacing: 8,
  },
  button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
  skip: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 4 },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center' },
})
