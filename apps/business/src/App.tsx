import { useState } from 'react'

import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { BusinessLogin } from './screens/BusinessLogin'
import { BusinessSignup } from './screens/BusinessSignup'
import { BusinessDashboard } from './screens/BusinessDashboard'

export function App() {
  const isAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)
  const [screen, setScreen] = useState<'login' | 'signup'>('login')
  useTheme()

  if (isAuthenticated) return <BusinessDashboard />

  if (screen === 'signup') {
    return <BusinessSignup onSwitchToLogin={() => setScreen('login')} />
  }

  return <BusinessLogin onSwitchToSignup={() => setScreen('signup')} />
}
