import { useAdminAuthStore } from './stores/adminAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { AdminLogin } from './screens/AdminLogin'
import { AdminDashboard } from './screens/AdminDashboard'

export function App() {
  const isAuthenticated = useAdminAuthStore((s) => s.isAuthenticated)
  useTheme()

  if (!isAuthenticated) return <AdminLogin />
  return <AdminDashboard />
}
