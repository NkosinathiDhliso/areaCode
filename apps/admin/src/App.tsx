import { useAdminAuthStore } from './stores/adminAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
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

  if (!isAuthenticated) return <AdminLogin />
  return <AdminDashboard />
}
