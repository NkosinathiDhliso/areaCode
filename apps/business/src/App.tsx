import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { BusinessLogin } from './screens/BusinessLogin'
import { BusinessSignup } from './screens/BusinessSignup'
import { BusinessDashboard } from './screens/BusinessDashboard'

const queryClient = new QueryClient()

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

function AppContent() {
  const isAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)
  const accessToken = useBusinessAuthStore((s) => s.accessToken)
  const businessId = useBusinessAuthStore((s) => s.businessId)
  const [screen, setScreen] = useState<'login' | 'signup'>('login')
  useTheme()

  // Wire API token provider
  useEffect(() => {
    api.setTokenProvider(() => useBusinessAuthStore.getState().accessToken)
  }, [])

  // Initialize socket with businessId for room authorization
  useEffect(() => {
    if (accessToken && businessId) {
      getSocket(accessToken, { businessId })
    }
  }, [accessToken, businessId])

  if (isAuthenticated) return <BusinessDashboard />

  if (screen === 'signup') {
    return <BusinessSignup onSwitchToLogin={() => setScreen('login')} />
  }

  return <BusinessLogin onSwitchToSignup={() => setScreen('signup')} />
}
