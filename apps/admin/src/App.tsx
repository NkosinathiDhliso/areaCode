import { useEffect } from 'react'
import { useAdminAuthStore } from './stores/adminAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { api } from '@area-code/shared/lib/api'
import { AdminLogin } from './screens/AdminLogin'
import { AdminDashboard } from './screens/AdminDashboard'

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  )
}

function AppContent() {
  const isAuthenticated = useAdminAuthStore((s) => s.isAuthenticated)
  useTheme()

  // Wire API token provider so all requests include the admin access token
  useEffect(() => {
    api.setTokenProvider(() => useAdminAuthStore.getState().accessToken)
  }, [])

  if (!isAuthenticated) return <AdminLogin />
  return <AdminDashboard />
}
