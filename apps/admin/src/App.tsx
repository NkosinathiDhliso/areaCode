import { useAdminAuthStore } from './stores/adminAuthStore'
import { AdminLogin } from './screens/AdminLogin'
import { AdminDashboard } from './screens/AdminDashboard'

export function App() {
  const isAuthenticated = useAdminAuthStore((s) => s.isAuthenticated)

  if (!isAuthenticated) return <AdminLogin />
  return <AdminDashboard />
}
