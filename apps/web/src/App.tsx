import { useState, useEffect, useCallback, useRef } from 'react'

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
    useConsumerAuthStore.getState().logout()
    window.location.href = '/login'
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

  // Check onboarding status after login
  useEffect(() => {
    if (!isAuthenticated || onboardingChecked) return
    async function checkOnboarding() {
      try {
        const profile = await api.get<{ onboardingComplete?: boolean }>('/v1/users/me')
        if (profile.onboardingComplete === false) {
          setShowOnboarding(true)
        }
      } catch (err: unknown) {
        const apiErr = err as { statusCode?: number } | undefined
        if (apiErr?.statusCode === 401) {
          useConsumerAuthStore.getState().logout()
          setRoute('login')
          return
        }
      } finally {
        setOnboardingChecked(true)
      }
    }
    void checkOnboarding()
  }, [isAuthenticated, onboardingChecked, setRoute])

  // Must be called before any conditional returns to satisfy Rules of Hooks
  const activeDefaultTab = useNavigationStore((s) => s.activeDefaultTab)

  // Auth screens render without bottom nav
  if (!isAuthenticated) {
    if (window.location.pathname.startsWith('/auth/callback')) {
      return <ConsumerOAuthCallback onNavigate={setRoute} />
    }
    if (route === 'landing') return <AuthLanding onNavigate={setRoute} />
    if (route === 'login') return <ConsumerLogin onNavigate={setRoute} />
    if (route === 'signup') return <ConsumerSignup onNavigate={setRoute} />
  }

  // Redirect authenticated users from landing to their time-based default tab
  // Map tab is always accessible when explicitly navigated to
  if (isAuthenticated && route === 'landing') {
    const defaultRoute = activeDefaultTab as AppRoute
    if (defaultRoute === 'gets' || defaultRoute === 'ranks') {
      // Use effect-free redirect by rendering the correct screen
      return (
        <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
          <ConnectivityBanner />
          {showOnboarding && <OnboardingFlow onComplete={() => setShowOnboarding(false)} />}
          <div ref={contentRef} className="flex-1 relative overflow-hidden">
            {defaultRoute === 'gets' && <RewardsScreen />}
            {defaultRoute === 'ranks' && <LeaderboardScreen />}
          </div>
          <BottomNav active={defaultRoute} onNavigate={setRoute} />
        </div>
      )
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <ConnectivityBanner />
      {showOnboarding && <OnboardingFlow onComplete={() => setShowOnboarding(false)} />}
      <div ref={contentRef} className="flex-1 relative overflow-hidden">
        {route === 'map' && <MapScreen onNavigate={setRoute} />}
        {route === 'gets' && <RewardsScreen />}
        {route === 'ranks' && <LeaderboardScreen />}
        {route === 'feed' && <FeedScreen />}
        {route === 'friends' && <FriendsScreen />}
        {route === 'profile' && <ProfileScreen onNavigate={setRoute} />}
        {route === 'privacy' && <PrivacySettingsScreen onNavigate={setRoute} />}
        {route === 'history' && <CheckInHistoryScreen onNavigate={setRoute} />}
      </div>
      <BottomNav active={route} onNavigate={setRoute} />
    </div>
  )
}
