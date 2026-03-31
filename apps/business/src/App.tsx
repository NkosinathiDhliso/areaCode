import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { BusinessLogin } from './screens/BusinessLogin'
import { BusinessDashboard } from './screens/BusinessDashboard'

export function App() {
  const isAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)

  if (!isAuthenticated) return <BusinessLogin />
  return <BusinessDashboard />
}
