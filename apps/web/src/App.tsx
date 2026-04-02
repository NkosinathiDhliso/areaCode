import { useState, useEffect } from 'react'

import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useNavigationStore } from '@area-code/shared/stores/navigationStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'

import { MapScreen } from './screens/MapScreen'
import { RewardsScreen } from './screens/RewardsScreen'
import { LeaderboardScreen } from './screens/LeaderboardScreen'
import { FeedScreen } from './screens/FeedScreen'
import { FriendsScreen } from './screens/FriendsScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { ConsumerLogin } from './screens/ConsumerLogin'
import { ConsumerSignup } from './screens/ConsumerSignup'
import { AuthLanding } from './screens/AuthLanding'
import { BottomNav } from './components/BottomNav'
import { ConnectivityBanner } from './components/ConnectivityBanner'
import type { AppRoute } from './types'

export function App() {
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const resetNavigation = useNavigationStore((s) => s.resetNavigation)
  const { setOnline, setApiOnly, setOffline } = useConnectivityStore()

  // Activate SAST time-based theme (06:00–18:00 light, 18:00–06:00 dark)
  useTheme()

  const [route, setRoute] = useState<AppRoute>(() => {
    const path = window.location.pathname
    if (path === '/login') return 'login'
    if (path === '/signup/consumer') return 'signup'
    if (path === '/signup') return 'signup'
    if (path === '/map') return 'map'
    if (path === '/gets') return 'gets'
    if (path === '/ranks') return 'ranks'
    if (path === '/feed') return 'feed'
    if (path === '/friends') return 'friends'
    if (path === '/profile') return 'profile'
    return 'landing' // Default to landing page for root and unknown paths
  })

  // Wire API token provider once
  useEffect(() => {
    api.setTokenProvider(() => useConsumerAuthStore.getState().accessToken)
  }, [])

  // Reset time-based nav default on fresh app open
  useEffect(() => {
    resetNavigation()
  }, [resetNavigation])

  // Socket + connectivity state management
  useEffect(() => {
    const socket = getSocket(accessToken ?? undefined)

    socket.on('connect', () => setOnline())
    socket.on('disconnect', () => setApiOnly())

    const handleOnline = () => setOnline()
    const handleOffline = () => setOffline()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [accessToken, setOnline, setApiOnly, setOffline])

  // Auth screens render without bottom nav
  if (route === 'landing') return <AuthLanding onNavigate={setRoute} />
  if (route === 'login') return <ConsumerLogin onNavigate={setRoute} />
  if (route === 'signup') return <ConsumerSignup onNavigate={setRoute} />

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <ConnectivityBanner />
      <div className="flex-1 relative overflow-hidden">
        {route === 'map' && <MapScreen onNavigate={setRoute} />}
        {route === 'gets' && <RewardsScreen />}
        {route === 'ranks' && <LeaderboardScreen />}
        {route === 'feed' && <FeedScreen />}
        {route === 'friends' && <FriendsScreen />}
        {route === 'profile' && <ProfileScreen onNavigate={setRoute} />}
      </div>
      <BottomNav active={route} onNavigate={setRoute} />
    </div>
  )
}
