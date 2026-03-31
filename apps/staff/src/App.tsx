import { useState } from 'react'

import { useStaffAuthStore } from './stores/staffAuthStore'
import { StaffInvite } from './screens/StaffInvite'
import { StaffLogin } from './screens/StaffLogin'
import { StaffHome } from './screens/StaffHome'

export function App() {
  const isAuthenticated = useStaffAuthStore((s) => s.isAuthenticated)
  const [route] = useState(() => {
    const path = window.location.pathname
    if (path.startsWith('/staff-invite/')) return 'invite'
    return isAuthenticated ? 'home' : 'login'
  })

  if (route === 'invite') {
    const token = window.location.pathname.split('/staff-invite/')[1] ?? ''
    return <StaffInvite token={token} />
  }

  if (!isAuthenticated) return <StaffLogin />
  return <StaffHome />
}
