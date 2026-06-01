/**
 * Native global error toast for the mobile app.
 *
 * Mirrors the web `@area-code/shared/components/GlobalErrorToast`: it wires the
 * shared error store into the API client via `setApiErrorHandler` on mount, so
 * 5xx/timeout/network failures surfaced by the shared `api` client show a
 * dismissible toast. The shared web component renders DOM and can't run on RN,
 * so this is the React Native equivalent.
 *
 * Mount once near the navigation root (above the Stack) so it overlays all
 * screens.
 */

import { setApiErrorHandler } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { colors } from '../theme'

const AUTO_DISMISS_MS = 5000

export function GlobalErrorToast() {
  const { t } = useTranslation()
  const error = useErrorStore((s) => s.error)
  const clearError = useErrorStore((s) => s.clearError)
  const opacity = useRef(new Animated.Value(0)).current

  // Wire the error store into the shared API client once on mount.
  useEffect(() => {
    setApiErrorHandler(useErrorStore.getState().showError)
  }, [])

  // Fade in/out and auto-dismiss when an error is present.
  useEffect(() => {
    if (!error) return

    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => clearError())
    }, AUTO_DISMISS_MS)

    return () => clearTimeout(timer)
  }, [error, opacity, clearError])

  if (!error) return null

  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { opacity }]}>
      <View style={styles.toast} accessibilityRole="alert">
        <Text style={styles.message} numberOfLines={3}>
          {error}
        </Text>
        <TouchableOpacity onPress={clearError} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.dismiss}>{t('errors.dismiss')}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 90,
    alignItems: 'center',
    zIndex: 10001,
    paddingHorizontal: 20,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 360,
    width: '100%',
    backgroundColor: colors.bgRaised,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  message: { flex: 1, color: colors.textPrimary, fontSize: 13 },
  dismiss: { color: colors.accentBright, fontSize: 13, fontWeight: '600' },
})
