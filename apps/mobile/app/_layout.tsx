import { useEffect, useState } from 'react'
import * as WebBrowser from 'expo-web-browser'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

WebBrowser.maybeCompleteAuthSession()
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import { colors } from '../src/theme'
import '../src/i18n'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

export default function RootLayout() {
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const { setOnline, setApiOnly, setOffline } = useConnectivityStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    api.setTokenProvider(() => useConsumerAuthStore.getState().accessToken)
  }, [])

  useEffect(() => {
    const socket = getSocket(accessToken ?? undefined)
    const onConnect = () => setOnline()
    const onDisconnect = () => setApiOnly()
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [accessToken, setOnline, setApiOnly, setOffline])

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
