import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { GlobalErrorToast } from '@area-code/shared/components/GlobalErrorToast'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { api } from '@area-code/shared/lib/api'
import { useState, useEffect } from 'react'

import { StaffHome } from './screens/StaffHome'
import { StaffInvite } from './screens/StaffInvite'
import { StaffLogin } from './screens/StaffLogin'
import { StaffOAuthCallback } from './screens/StaffOAuthCallback'
import { useStaffAuthStore } from './stores/staffAuthStore'

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
      <GlobalErrorToast />
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

  // Wire API token provider and refresh handler
  useEffect(() => {
    api.setTokenProvider(() => useStaffAuthStore.getState().accessToken)
    api.setRefreshPath('/v1/auth/staff/refresh')
    api.setRefreshHandler({
      getRefreshToken: () => useStaffAuthStore.getState().refreshToken,
      onTokenRefreshed: (token) => useStaffAuthStore.getState().setAccessToken(token),
      onAuthExpired: () => useStaffAuthStore.getState().logout(),
    })
  }, [])

  if (window.location.pathname.startsWith('/auth/callback')) {
    return <StaffOAuthCallback />
  }

  if (route === 'invite') {
    const token = window.location.pathname.split('/staff-invite/')[1] ?? ''
    return <StaffInvite token={token} />
  }

  if (!isAuthenticated) return <StaffLogin />
  return <StaffHome />
}
