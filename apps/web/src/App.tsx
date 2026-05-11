import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'

import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useNavigationStore } from '@area-code/shared/stores/navigationStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { GlobalErrorToast } from '@area-code/shared/components/GlobalErrorToast'
import { OnboardingFlow } from '@area-code/shared/components/OnboardingFlow'

import { MapScreen } from './screens/MapScreen'
import { RewardsScreen } from './screens/RewardsScreen'
import { LeaderboardScreen } from './screens/LeaderboardScreen'
import { FeedScreen } from './screens/FeedScreen'
import { FriendsScreen } from './screens/FriendsScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { PrivacySettingsScreen } from './screens/PrivacySettingsScreen'
import { CheckInHistoryScreen } from './screens/CheckInHistoryScreen'
import { ConsumerLogin } from './screens/ConsumerLogin'
import { ConsumerSignup } from './screens/ConsumerSignup'
import { ConsumerOAuthCallback } from './screens/ConsumerOAuthCallback'
import { AuthLanding } from './screens/AuthLanding'
import { BottomNav } from './components/BottomNav'
import { ConnectivityBanner } from './components/ConnectivityBanner'
import type { AppRoute } from './types'

// Initialise API auth before any React render so queries fired during mount
// (e.g. after the Spotify OAuth redirect) always have the Authorization header.
api.setTokenProvider(() => useConsumerAuthStore.getState().accessToken)
api.setRefreshHandler({
  getRefreshToken: () => useConsumerAuthStore.getState().refreshToken,
  onTokenRefreshed: (token) => useConsumerAuthStore.getState().setAccessToken(token),
  onAuthExpired: () => {
    // Navigate first to prevent React re-renders with stale auth state (avoids error #310)
    // The login page will clear auth state on mount
    useConsumerAuthStore.getState().logout()
    // Use replace to avoid back-button loops
    if (window.location.pathname !== '/login') {
      window.location.replace('/login')
    }
  },
})

const ROUTE_PATHS: Record<AppRoute, string> = {
  landing: '/',
  login: '/login',
  signup: '/signup',
  map: '/map',
  gets: '/gets',
  ranks: '/ranks',
  feed: '/feed',
  friends: '/friends',
  profile: '/profile',
  privacy: '/privacy',
  history: '/history',
}

function pathToRoute(path: string): AppRoute {
  if (path === '/login') return 'login'
  if (path === '/signup/consumer' || path === '/signup') return 'signup'
  if (path === '/map') return 'map'
  if (path === '/gets') return 'gets'
  if (path === '/ranks') return 'ranks'
  if (path === '/feed') return 'feed'
  if (path === '/friends') return 'friends'
  if (path === '/profile') return 'profile'
  if (path === '/privacy') return 'privacy'
  if (path === '/history') return 'history'
  return 'landing'
}

export function App() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      import('@axe-core/react').then((axe) => {
        axe.default(React, ReactDOM, 1000)
      })
    }
  }, [])

  return (
    <ErrorBoundary>
      <AppContent />
      <GlobalErrorToast />
    </ErrorBoundary>
  )
}

function AppContent() {
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const accessToken = useConsumerAuthStore((s) => s.accessToken)
  const resetNavigation = useNavigationStore((s) => s.resetNavigation)
  const setOnline = useConnectivityStore((s) => s.setOnline)
  const setApiOnly = useConnectivityStore((s) => s.setApiOnly)
  const setOffline = useConnectivityStore((s) => s.setOffline)

  // Activate SAST time-based theme (06:00–18:00 light, 18:00–06:00 dark)
  useTheme()

  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)

  const [route, setRouteState] = useState<AppRoute>(() => pathToRoute(window.location.pathname))

  // Ref for scroll-to-top on tab change (Issue #38)
  const contentRef = useRef<HTMLDivElement>(null)

  // Navigate with browser history support (Issue #9)
  const setRoute = useCallback((newRoute: AppRoute) => {
    setRouteState(newRoute)
    const path = ROUTE_PATHS[newRoute] ?? '/'
    if (window.location.pathname !== path) {
      window.history.pushState({ route: newRoute }, '', path)
    }
    // Scroll to top on tab change (Issue #38)
    if (contentRef.current) {
      const scrollable = contentRef.current.querySelector('[data-scroll-container]')
      if (scrollable) scrollable.scrollTop = 0
    }
  }, [])

  // Handle browser back/forward buttons (Issue #9)
  useEffect(() => {
    function handlePopState() {
      const newRoute = pathToRoute(window.location.pathname)
      setRouteState(newRoute)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Reset time-based nav default on fresh app open
  useEffect(() => {
    resetNavigation()
  }, [resetNavigation])

  // Socket + connectivity state management
  useEffect(() => {
    const socket = getSocket(accessToken ?? undefined)

    const handleConnect = () => setOnline()
    const handleDisconnect = () => setApiOnly()
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)

    const handleOnline = () => setOnline()
    const handleOffline = () => setOffline()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [accessToken, setOnline, setApiOnly, setOffline])

  // Check onboarding status after login
  useEffect(() => {
    if (!isAuthenticated || onboardingChecked) return
    async function checkOnboarding() {
      try {
        const profile = await api.get<{ onboardingComplete?: boolean }>('/v1/users/me')
        if (profile.onboardingComplete === false) {
          setShowOnboarding(true)
        }
      } catch {
        // Silently skip — the API's setRefreshHandler handles real token
        // expiry. Forcing logout here breaks the Google OAuth flow because
        // /v1/users/me can transiently 401 before Cognito propagates the session.
      } finally {
        setOnboardingChecked(true)
      }
    }
    void checkOnboarding()
  }, [isAuthenticated, onboardingChecked, setRoute])

  // Must be called before any conditional returns to satisfy Rules of Hooks
  const activeDefaultTab = useNavigationStore((s) => s.activeDefaultTab)

  // OAuth callback is the only screen rendered without the shell
  if (window.location.pathname.startsWith('/auth/callback')) {
    return <ConsumerOAuthCallback onNavigate={setRoute} />
  }

  // Onboarding takes the entire screen until completed — never overlay it on top
  // of other screens (stacking-context bugs caused content bleed-through).
  if (showOnboarding) {
    return <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
  }

  // Authenticated users landing on root: route them to their time-based default tab
  let activeRoute = route
  if (isAuthenticated && route === 'landing') {
    activeRoute = activeDefaultTab as AppRoute
  }

  // Gated routes for unauthenticated users fall back to the auth landing
  const GATED: ReadonlyArray<AppRoute> = ['gets', 'ranks', 'feed', 'friends', 'profile', 'privacy', 'history']
  const showAuthGate = !isAuthenticated && GATED.includes(activeRoute)

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <ConnectivityBanner />
      <div ref={contentRef} className="flex-1 relative overflow-hidden">
        {showAuthGate ? (
          <AuthLanding onNavigate={setRoute} />
        ) : (
          <>
            {activeRoute === 'landing' && !isAuthenticated && <AuthLanding onNavigate={setRoute} />}
            {activeRoute === 'login' && <ConsumerLogin onNavigate={setRoute} />}
            {activeRoute === 'signup' && <ConsumerSignup onNavigate={setRoute} />}
            {activeRoute === 'map' && <MapScreen onNavigate={setRoute} />}
            {activeRoute === 'gets' && <RewardsScreen />}
            {activeRoute === 'ranks' && <LeaderboardScreen />}
            {activeRoute === 'feed' && <FeedScreen />}
            {activeRoute === 'friends' && <FriendsScreen />}
            {activeRoute === 'profile' && <ProfileScreen onNavigate={setRoute} />}
            {activeRoute === 'privacy' && <PrivacySettingsScreen onNavigate={setRoute} />}
            {activeRoute === 'history' && <CheckInHistoryScreen onNavigate={setRoute} />}
          </>
        )}
      </div>
      <BottomNav active={activeRoute} onNavigate={setRoute} />
    </div>
  )
}
