import { useEffect, useState } from 'react'
import * as WebBrowser from 'expo-web-browser'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

WebBrowser.maybeCompleteAuthSession()
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { api } from '@area-code/shared/lib/api'
import { colors } from '../src/theme'
import '../src/i18n'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

export default function RootLayout() {
  const { setOnline } = useConnectivityStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    api.setTokenProvider(() => useConsumerAuthStore.getState().accessToken)
  }, [])

  // Connectivity state management (replaces WebSocket connectivity)
  // Assume online initially; API error handling will surface connectivity issues
  useEffect(() => {
    setOnline()
  }, [setOnline])

  if (!ready) return null

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgBase },
          animation: 'fade',
        }}
      />
    </QueryClientProvider>
  )
}
