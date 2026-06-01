/**
 * Native runtime wiring for the shared layer.
 *
 * The shared package (`@area-code/shared`) is platform-agnostic and resolves
 * its config from Vite env vars on web. On React Native none of that exists,
 * so this module injects the equivalents at boot:
 *
 *  - persistent storage   → AsyncStorage (hydrated into the sync cache)
 *  - API base URL          → expo-constants extra / EXPO_PUBLIC_API_URL
 *  - WebSocket URL         → expo-constants extra / EXPO_PUBLIC_WEBSOCKET_URL
 *  - token refresh handler → consumer auth store
 *  - geolocation provider  → expo-location
 *
 * `bootstrapNative()` must run (and its storage hydration awaited) before the
 * first React render so the auth store reads persisted tokens.
 */

import { api } from '@area-code/shared/lib/api'
import { setGeolocationProvider } from '@area-code/shared/lib/platform'
import { setWebSocketUrl } from '@area-code/shared/lib/socket'
import { storage } from '@area-code/shared/lib/storage'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Location from 'expo-location'

function extra(): Record<string, string | undefined> {
  return (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>
}

function resolveApiUrl(): string | undefined {
  return process.env.EXPO_PUBLIC_API_URL?.trim() || extra()['apiUrl']
}

function resolveWebSocketUrl(): string | undefined {
  return process.env.EXPO_PUBLIC_WEBSOCKET_URL?.trim() || extra()['webSocketUrl']
}

/** Wire the shared layer for React Native. Idempotent. */
export async function bootstrapNative(): Promise<void> {
  // 1. Persistence — hydrate the synchronous cache from AsyncStorage so the
  //    zustand stores (created at import time) can read persisted values.
  await storage.configureAsyncBackend(AsyncStorage)

  // 2. After hydration, the auth store may have been created with an empty
  //    cache. Re-seed it from the now-populated cache.
  rehydrateAuthFromStorage()
  // zustand's persist middleware (userStore) also read an empty cache at
  // import time; ask it to rehydrate now that the backend is wired.
  void useUserStore.persist?.rehydrate?.()

  // 3. API base URL + token refresh.
  const apiUrl = resolveApiUrl()
  if (apiUrl) api.setBaseUrl(apiUrl)
  api.setTokenProvider(() => useConsumerAuthStore.getState().accessToken)
  api.setRefreshHandler({
    getRefreshToken: () => useConsumerAuthStore.getState().refreshToken,
    onTokenRefreshed: (token) => useConsumerAuthStore.getState().setAccessToken(token),
    onAuthExpired: () => useConsumerAuthStore.getState().logout(),
  })

  // 4. WebSocket origin for live pulse / archetype updates.
  const wsUrl = resolveWebSocketUrl()
  if (wsUrl) setWebSocketUrl(wsUrl)

  // 5. Geolocation backed by expo-location, adapted to the browser-style
  //    callback contract the shared `useGeolocation` hook expects.
  setGeolocationProvider({
    getCurrentPosition(onSuccess, onError, options) {
      void (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync()
          if (status !== Location.PermissionStatus.GRANTED) {
            onError({ code: 1, PERMISSION_DENIED: 1 })
            return
          }
          const pos = await Location.getCurrentPositionAsync({
            accuracy: options?.enableHighAccuracy ? Location.Accuracy.High : Location.Accuracy.Balanced,
          })
          onSuccess({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 9999,
          })
        } catch {
          // Non-permission failure (e.g. location services off) — map to a
          // generic error so the hook falls back to last-known/timeout.
          onError({ code: 2, PERMISSION_DENIED: 1 })
        }
      })()
    },
  })
}

/**
 * Re-seed the consumer auth store from the (now hydrated) storage cache.
 *
 * The store module reads `storage.get(...)` at import time, which on RN runs
 * before AsyncStorage hydration completes and therefore returns null. Once the
 * cache is populated we push the persisted session back into the store.
 */
function rehydrateAuthFromStorage(): void {
  const accessToken = storage.get('consumer:accessToken')
  const refreshToken = storage.get('consumer:refreshToken')
  const userId = storage.get('consumer:userId')
  const sessionId = storage.get('consumer:sessionId')
  if (accessToken && refreshToken && userId) {
    useConsumerAuthStore.getState().setAuth(accessToken, refreshToken, userId, sessionId ?? undefined)
  }
}
