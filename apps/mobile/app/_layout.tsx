import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'

WebBrowser.maybeCompleteAuthSession()

import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { getSocket } from '@area-code/shared/lib/socket'
import { storage } from '@area-code/shared/lib/storage'
import { useNodePulse } from '@area-code/shared/hooks/useNodePulse'
import { useRewardSocket } from '@area-code/shared/hooks/useRewardSocket'
import { useNotificationSocket } from '@area-code/shared/hooks/useNotificationSocket'

import { GlobalErrorToast } from '../src/components/GlobalErrorToast'
import { bootstrapNative } from '../src/lib/bootstrap'
import { registerForPushNotifications, attachNotificationResponseHandler } from '../src/lib/push'
import '../src/i18n'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

const CITY_SLUG = 'johannesburg'
const PENDING_QR_KEY = 'pendingQrCheckIn'

export default function RootLayout() {
  const router = useRouter()
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const { setOnline, setApiOnly } = useConnectivityStore()
  const [ready, setReady] = useState(false)

  // Wire the shared layer for React Native (storage, API, socket, geo) before
  // first render so the auth store reads persisted tokens.
  useEffect(() => {
    let cancelled = false
    async function init() {
      await bootstrapNative()
      if (__DEV__ && process.env.EXPO_PUBLIC_DEV_MOCK === 'true') {
        const { initDevMocks } = await import('@area-code/shared/mocks')
        await initDevMocks()
      }
      if (!cancelled) setReady(true)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  // Connectivity lifecycle from the socket.
  useEffect(() => {
    if (!ready) return
    const socket = getSocket(accessToken ?? undefined, { citySlug: CITY_SLUG })
    const onConnect = () => setOnline()
    const onDisconnect = () => setApiOnly()
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [ready, accessToken, setOnline, setApiOnly])

  // Subscribe to live pulse updates so map markers reflect realtime activity.
  useNodePulse(accessToken ?? undefined, { citySlug: CITY_SLUG })

  // Register for push notifications once authenticated. Fire-and-forget: the
  // helper requests OS permission, acquires an Expo push token, and upserts it
  // to the backend (POST /v1/users/me/push-token). Re-runs on token change so a
  // fresh sign-in re-attributes the device token to the new user.
  useEffect(() => {
    if (!ready || !isAuthenticated) return
    void registerForPushNotifications()
  }, [ready, isAuthenticated, accessToken])

  // Deep-link notification taps to the relevant screen (reward → /rewards,
  // node/check-in → map). Also drains a cold-start tap that launched the app.
  useEffect(() => {
    if (!ready) return
    return attachNotificationResponseHandler(router)
  }, [ready, router])

  // Resume a pending QR check-in after sign-in. An unauthenticated visitor who
  // scans a venue QR has {nodeId, token} stashed by the QR screen; once
  // authenticated, send them back to the deep link to complete the check-in.
  useEffect(() => {
    if (!ready || !isAuthenticated) return
    const pending = storage.getJSON<{ nodeId?: string; token?: string }>(PENDING_QR_KEY)
    if (pending?.nodeId && pending.token) {
      storage.remove(PENDING_QR_KEY)
      router.replace(`/qr/${pending.nodeId}/${pending.token}`)
    }
  }, [ready, isAuthenticated, router])

  if (!ready) return null

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a0a0f' },
          animation: 'fade',
        }}
      />
      <GlobalErrorToast />
    </QueryClientProvider>
  )
}
