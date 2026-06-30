import {} from 'react'
import { useAdminAuthStore } from './stores/adminAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { GlobalErrorToast } from '@area-code/shared/components/GlobalErrorToast'
import { api } from '@area-code/shared/lib/api'
import { AdminLogin } from './screens/AdminLogin'
import { AdminOAuthCallback } from './screens/AdminOAuthCallback'
import { AdminDashboard } from './screens/AdminDashboard'

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
      <GlobalErrorToast />
    </ErrorBoundary>
  )
}

function AppContent() {
  const isAuthenticated = useAdminAuthStore((s) => s.isAuthenticated)
  useTheme()

  // Wire synchronously so the token is attached before any child useEffect fires a fetch.
  // (React runs child effects before parent effects, so useEffect here would be too late.)
  api.setTokenProvider(() => useAdminAuthStore.getState().accessToken)
  api.setRefreshPath('/v1/auth/admin/refresh')
  api.setRefreshHandler({
    getRefreshToken: () => useAdminAuthStore.getState().refreshToken,
    onTokenRefreshed: (token) => useAdminAuthStore.getState().setAccessToken(token),
    onAuthExpired: () => useAdminAuthStore.getState().logout(),
  })

  if (window.location.pathname.startsWith('/auth/callback')) {
    return <AdminOAuthCallback />
  }

  if (!isAuthenticated) return <AdminLogin />
  return <AdminDashboard />
}
