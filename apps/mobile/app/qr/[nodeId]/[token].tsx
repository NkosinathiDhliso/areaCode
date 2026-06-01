import { api, type ApiError } from '@area-code/shared/lib/api'
import { storage } from '@area-code/shared/lib/storage'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import type { CheckInResponse } from '@area-code/shared/types'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'

import { colors } from '../../../src/theme'

type Phase = 'submitting' | 'success' | 'unauthenticated' | 'error'

const PENDING_QR_KEY = 'pendingQrCheckIn'

/**
 * Landing screen for venue-printed QR codes deep-linked as
 * areacode.co.za/qr/{nodeId}/{token}. Mirrors the web QrCheckIn flow:
 * posts the token to /v1/check-in, then routes back to the map. If the
 * visitor isn't signed in we stash the pending check-in and send them to
 * login; the root layout resumes it after auth.
 */
export default function QrCheckIn() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useLocalSearchParams<{ nodeId: string; token: string }>()
  const nodeId = params.nodeId
  const token = params.token
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)

  const [phase, setPhase] = useState<Phase>('submitting')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!nodeId || !token) {
      setPhase('error')
      setMessage(t('qr.generic', 'Check-in failed. Please try again at the venue.'))
      return
    }

    if (!isAuthenticated) {
      storage.setJSON(PENDING_QR_KEY, { nodeId, token })
      setPhase('unauthenticated')
      return
    }

    let cancelled = false
    async function submit() {
      try {
        const res = await api.post<CheckInResponse>('/v1/check-in', { nodeId, qrToken: token, type: 'reward' })
        if (cancelled) return
        setPhase('success')
        setMessage(
          res.cooldownUntil
            ? `${t('qr.checkedIn', "You're checked in.")} ${t('qr.cooldownHint', 'Come back again after your cooldown ends.')}`
            : t('qr.checkedIn', "You're checked in."),
        )
        setTimeout(() => {
          if (!cancelled) router.replace('/')
        }, 1800)
      } catch (err) {
        if (cancelled) return
        const apiErr = err as ApiError
        setPhase('error')
        if (apiErr.statusCode === 401) {
          setMessage(t('qr.invalidToken', 'This QR code is no longer valid. Ask the venue to reprint.'))
        } else if (apiErr.statusCode === 429) {
          setMessage(apiErr.message ?? t('qr.cooldown', 'You have already checked in here recently.'))
        } else if (apiErr.statusCode === 404) {
          setMessage(t('qr.venueGone', 'This venue is no longer listed.'))
        } else {
          setMessage(apiErr.message ?? t('qr.generic', 'Check-in failed. Please try again at the venue.'))
        }
      }
    }
    void submit()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, nodeId, token, router, t])

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {phase === 'submitting' && (
          <>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.title}>{t('qr.checkingIn', 'Checking you in…')}</Text>
          </>
        )}

        {phase === 'success' && (
          <>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.title}>{t('qr.success', 'Checked in')}</Text>
            <Text style={styles.body}>{message}</Text>
          </>
        )}

        {phase === 'unauthenticated' && (
          <>
            <Text style={styles.title}>{t('qr.signInTitle', 'Sign in to check in')}</Text>
            <Text style={styles.body}>{t('qr.signInHint', "We'll bring you right back here after you sign in.")}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/auth/login')}>
              <Text style={styles.primaryButtonText}>{t('qr.signInCta', 'Sign in')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/auth/signup')}>
              <Text style={styles.secondaryButtonText}>{t('qr.signUpCta', 'Create an account')}</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'error' && (
          <>
            <Text style={styles.errorIcon}>!</Text>
            <Text style={styles.title}>{t('qr.errorTitle', "Couldn't check you in")}</Text>
            <Text style={styles.body}>{message}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/')}>
              <Text style={styles.primaryButtonText}>{t('qr.openMap', 'Open the map')}</Text>
            </TouchableOpacity>
          </>
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
    paddingHorizontal: 24,
  },
  content: { width: '100%', maxWidth: 320, alignItems: 'center', gap: 16 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 20, textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  successIcon: { color: colors.success, fontSize: 40, fontWeight: '700' },
  errorIcon: {
    color: colors.danger,
    fontSize: 32,
    fontWeight: '700',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.danger,
    textAlign: 'center',
    lineHeight: 44,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  secondaryButton: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
})
