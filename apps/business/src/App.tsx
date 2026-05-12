import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { GlobalErrorToast } from '@area-code/shared/components/GlobalErrorToast'
import { BusinessLogin } from './screens/BusinessLogin'
import { BusinessSignup } from './screens/BusinessSignup'
import { BusinessOAuthCallback } from './screens/BusinessOAuthCallback'
import { BusinessDashboard } from './screens/BusinessDashboard'

const queryClient = new QueryClient()

// Wire once at module load — before any component renders
api.setTokenProvider(() => useBusinessAuthStore.getState().accessToken)
// Managers use staff Cognito pool for refresh; owners use business pool.
// Check stored role to set the correct path immediately on page load.
const storedRole = useBusinessAuthStore.getState().role
api.setRefreshPath(storedRole === 'manager' ? '/v1/auth/staff/refresh' : '/v1/auth/business/refresh')
api.setRefreshHandler({
  getRefreshToken: () => useBusinessAuthStore.getState().refreshToken,
  onTokenRefreshed: (token) => useBusinessAuthStore.getState().setAccessToken(token),
  onAuthExpired: () => useBusinessAuthStore.getState().logout(),
})

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppContent />
        <GlobalErrorToast />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

function AppContent() {
  const isAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)
  const accessToken = useBusinessAuthStore((s) => s.accessToken)
  const businessId = useBusinessAuthStore((s) => s.businessId)
  const setRole = useBusinessAuthStore((s) => s.setRole)
  const [screen, setScreen] = useState<'login' | 'signup'>('login')
  useTheme()

  // Initialize socket with businessId for room authorization
  useEffect(() => {
    if (accessToken && businessId) {
      getSocket(accessToken, { businessId })
    }
  }, [accessToken, businessId])

  // Fetch role and permissions on auth
  useEffect(() => {
    if (!isAuthenticated) return
    api.get<{ role: 'owner' | 'manager' | 'staff'; permissions: string[] }>('/v1/business/me/role')
      .then((res) => {
        setRole(res.role, res.permissions)
        // Managers authenticate via staff Cognito pool — use staff refresh path
        if (res.role === 'manager') {
          api.setRefreshPath('/v1/auth/staff/refresh')
        }
      })
      .catch(() => {
        // Fallback: assume owner if role endpoint fails (backward compat)
        setRole('owner', [])
      })
  }, [isAuthenticated, setRole])

  if (isAuthenticated) return <BusinessDashboard />

  if (window.location.pathname.startsWith('/auth/callback')) {
    return <BusinessOAuthCallback />
  }

  if (screen === 'signup') {
    return <BusinessSignup onSwitchToLogin={() => setScreen('login')} />
  }

  return <BusinessLogin onSwitchToSignup={() => setScreen('signup')} />
}
