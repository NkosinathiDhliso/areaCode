import { useState } from 'react'

import { useStaffAuthStore } from './stores/staffAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { api } from '@area-code/shared/lib/api'
import { StaffInvite } from './screens/StaffInvite'
import { StaffLogin } from './screens/StaffLogin'
import { StaffHome } from './screens/StaffHome'

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  )
}

function AppContent() {
  const isAuthenticated = useStaffAuthStore((s) => s.isAuthenticated)
  useTheme()
  const [route] = useState(() => {
    const path = window.location.pathname
    if (path.startsWith('/staff-invite/')) return 'invite'
    return isAuthenticated ? 'home' : 'login'
  })

  // Wire API token provider
  useState(() => {
    api.setTokenProvider(() => useStaffAuthStore.getState().accessToken)
  })

  if (route === 'invite') {
    const token = window.location.pathname.split('/staff-invite/')[1] ?? ''
    return <StaffInvite token={token} />
  }

  if (!isAuthenticated) return <StaffLogin />
  return <StaffHome />
}
