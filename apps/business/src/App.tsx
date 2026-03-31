import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { BusinessLogin } from './screens/BusinessLogin'
import { BusinessDashboard } from './screens/BusinessDashboard'

export function App() {
  const isAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)
  useTheme()

  if (!isAuthenticated) return <BusinessLogin />
  return <BusinessDashboard />
}
