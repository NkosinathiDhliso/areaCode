import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import '../src/i18n'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

export default function RootLayout() {
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const { setOnline, setApiOnly, setOffline } = useConnectivityStore()

  useEffect(() => {
    api.setTokenProvider(() => useConsumerAuthStore.getState().accessToken)
  }, [])

  useEffect(() => {
    const socket = getSocket(accessToken ?? undefined)
    socket.on('connect', () => setOnline())
    socket.on('disconnect', () => setApiOnly())
    return () => {
      socket.off('connect')
      socket.off('disconnect')
    }
  }, [accessToken, setOnline, setApiOnly, setOffline])

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
    </QueryClientProvider>
  )
}
