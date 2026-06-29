import { useState, useEffect, useCallback, useRef } from 'react'

import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useNavigationStore } from '@area-code/shared/stores/navigationStore'
import { useSelectionStore } from '@area-code/shared/stores/selectionStore'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import { useAppHeight } from '@area-code/shared/hooks/useAppHeight'
import { useRewardSocket } from '@area-code/shared/hooks/useRewardSocket'
import { useNotificationSocket } from '@area-code/shared/hooks/useNotificationSocket'
import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import type { User } from '@area-code/shared/types'
import { ErrorBoundary } from '@area-code/shared/components/ErrorBoundary'
import { GlobalErrorToast } from '@area-code/shared/components/GlobalErrorToast'
import { OnboardingFlow } from '@area-code/shared/components/OnboardingFlow'

import { useFriendsPresence } from './hooks/useFriendsPresence'
import { MapScreen } from './screens/MapScreen'
import { LeaderboardScreen } from './screens/LeaderboardScreen'
import { FeedScreen } from './screens/FeedScreen'
import { FriendsScreen } from './screens/FriendsScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { PrivacySettingsScreen } from './screens/PrivacySettingsScreen'
import { NotificationCenter } from './screens/NotificationCenter'
import { NotificationSettings } from './screens/NotificationSettings'
import { CheckInHistoryScreen } from './screens/CheckInHistoryScreen'
import { ConsumerLogin } from './screens/ConsumerLogin'
import { ConsumerSignup } from './screens/ConsumerSignup'
import { ConsumerOAuthCallback } from './screens/ConsumerOAuthCallback'
import { VerifyEmail } from './screens/VerifyEmail'
import { AuthLanding } from './screens/AuthLanding'
import { ForgotPassword } from './screens/ForgotPassword'
import { FirstGetPrompt } from './screens/FirstGetPrompt'
import { QrCheckIn } from './screens/QrCheckIn'
import { PrivacyPolicyScreen } from './screens/PrivacyPolicyScreen'
import { TermsScreen } from './screens/TermsScreen'
import { BottomNav } from './components/BottomNav'
import { ConnectivityBanner } from './components/ConnectivityBanner'
import { VerifyEmailBanner } from './components/VerifyEmailBanner'
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
  'forgot-password': '/forgot-password',
  'first-get-prompt': '/first-get-prompt',
  map: '/map',
  ranks: '/ranks',
  feed: '/feed',
  friends: '/friends',
  profile: '/profile',
  privacy: '/privacy',
  notifications: '/notifications',
  'notification-settings': '/notifications/settings',
  history: '/history',
  'legal-privacy': '/legal/privacy',
  'legal-terms': '/legal/terms',
}

function pathToRoute(path: string): AppRoute {
  if (path === '/login') return 'login'
  if (path === '/signup/consumer' || path === '/signup') return 'signup'
  if (path === '/forgot-password') return 'forgot-password'
  if (path === '/first-get-prompt') return 'first-get-prompt'
  if (path === '/map') return 'map'
  // The standalone gets/deals tab was removed; keep old links working by
  // redirecting them to the map, where gets now surface as a reward layer.
  if (path === '/gets') return 'map'
  if (path === '/ranks') return 'ranks'
  if (path === '/feed') return 'feed'
  if (path === '/friends') return 'friends'
  if (path === '/profile') return 'profile'
  if (path === '/privacy') return 'privacy'
  if (path === '/notifications/settings') return 'notification-settings'
  if (path === '/notifications') return 'notifications'
  if (path === '/history') return 'history'
  if (path === '/legal/privacy') return 'legal-privacy'
  if (path === '/legal/terms') return 'legal-terms'
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

  // Activate SAST time-based theme (06:00-18:00 light, 18:00-06:00 dark)
  useTheme()

  // Pin the shell to the real visible viewport height (iOS Safari dvh/vh gap).
  useAppHeight()

  // App-wide live subscriptions: reward codes land in the wallet and
  // notification/tier events feed the notification center from any screen,
  // not just the map. These no-op until a token is present.
  useRewardSocket(accessToken ?? undefined)
  useNotificationSocket(accessToken ?? undefined)
  // Friends presence: seed from API on auth, listen for socket events,
  // re-seed on reconnect, clear on logout (R3.1, R3.4, R3.5, R14.1).
  useFriendsPresence(accessToken ?? undefined)

  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const setUser = useUserStore((s) => s.setUser)

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
        const profile = await api.get<User>('/v1/users/me')
        // Populate the shared user store so other surfaces (e.g. the email
        // verification banner) can read profile state without a second fetch.
        setUser(profile)
        if (profile.onboardingComplete === false) {
          setShowOnboarding(true)
        }
      } catch {
        // Silently skip - the API's setRefreshHandler handles real token
        // expiry. Forcing logout here breaks the Google OAuth flow because
        // /v1/users/me can transiently 401 before Cognito propagates the session.
      } finally {
        setOnboardingChecked(true)
      }
    }
    void checkOnboarding()
  }, [isAuthenticated, onboardingChecked, setRoute])

  // Resume a pending QR check-in after sign-in.
  // When an unauthenticated visitor scans a venue QR (areacode.co.za/qr/...),
  // the QrCheckIn screen stashes {nodeId, token} in sessionStorage and routes
  // them to login. Once authenticated, send them back to the same deep link so
  // the check-in completes.
  useEffect(() => {
    if (!isAuthenticated) return
    let pending: { nodeId?: string; token?: string } | null = null
    try {
      const raw = sessionStorage.getItem('pendingQrCheckIn')
      if (raw) pending = JSON.parse(raw) as { nodeId?: string; token?: string }
    } catch {
      pending = null
    }
    if (pending?.nodeId && pending.token) {
      sessionStorage.removeItem('pendingQrCheckIn')
      window.location.replace(`/qr/${pending.nodeId}/${pending.token}`)
    }
  }, [isAuthenticated])

  // Must be called before any conditional returns to satisfy Rules of Hooks
  const activeDefaultTab = useNavigationStore((s) => s.activeDefaultTab)

  // The route the shell will actually render. Authenticated users landing on
  // root are routed to their time-based default tab.
  const resolvedRoute: AppRoute = isAuthenticated && route === 'landing' ? (activeDefaultTab as AppRoute) : route

  // Keep the Map mounted once it has first been shown. Switching tabs hides it
  // with CSS instead of unmounting it, so Mapbox is never torn down and
  // re-initialised — this removes the "Loading map…" flash that appeared on
  // every tab change. `display:none` also drops it out of the keyboard tab
  // order while inactive.
  const [mapMounted, setMapMounted] = useState(false)
  useEffect(() => {
    if (resolvedRoute === 'map') setMapMounted(true)
  }, [resolvedRoute])

  // OAuth callback is the only screen rendered without the shell
  if (window.location.pathname.startsWith('/auth/callback')) {
    return <ConsumerOAuthCallback onNavigate={setRoute} />
  }

  // Email-verification deep link: /verify-email?token=…
  // Rendered full-screen and reachable without the bottom-nav shell; the token
  // in the URL is the proof, so no auth is required to land here.
  if (window.location.pathname === '/verify-email') {
    return <VerifyEmail onNavigate={setRoute} />
  }

  // Public legal pages - must be reachable without login (Google OAuth
  // verification fetches these URLs) and without the bottom nav.
  if (window.location.pathname === '/legal/privacy') {
    return <PrivacyPolicyScreen onNavigate={setRoute} />
  }
  if (window.location.pathname === '/legal/terms') {
    return <TermsScreen onNavigate={setRoute} />
  }

  // Venue-printed QR deep link: /qr/{nodeId}/{token}
  // Rendered full-screen so it completes the check-in flow before returning
  // the user to the map.
  const qrMatch = window.location.pathname.match(/^\/qr\/([^/]+)\/([^/?#]+)/)
  if (qrMatch) {
    const [, qrNodeId, qrToken] = qrMatch
    if (qrNodeId && qrToken) {
      return <QrCheckIn nodeId={qrNodeId} token={qrToken} onNavigate={setRoute} />
    }
  }

  // Onboarding takes the entire screen until completed - never overlay it on top
  // of other screens (stacking-context bugs caused content bleed-through).
  if (showOnboarding) {
    return <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
  }

  // Authenticated users landing on root: route them to their time-based default tab
  const activeRoute = resolvedRoute

  // Gated routes for unauthenticated users fall back to the auth landing
  const GATED: ReadonlyArray<AppRoute> = [
    'ranks',
    'feed',
    'friends',
    'profile',
    'privacy',
    'notifications',
    'notification-settings',
    'history',
  ]
  const showAuthGate = !isAuthenticated && GATED.includes(activeRoute)

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)]">
      <ConnectivityBanner />
      {isAuthenticated && !showAuthGate && <VerifyEmailBanner />}
      <div ref={contentRef} className="flex-1 relative overflow-x-hidden overflow-y-auto overscroll-y-contain">
        {showAuthGate ? (
          <AuthLanding onNavigate={setRoute} />
        ) : (
          <>
            {/* Persisted Map. Mounted once first shown and then only hidden
                (never unmounted) on tab switch, so Mapbox is not torn down and
                re-initialised. `display:none` keeps it out of the tab order and
                interaction while another tab is active. */}
            {mapMounted && (
              <div className="absolute inset-0" style={{ display: activeRoute === 'map' ? undefined : 'none' }}>
                <MapScreen onNavigate={setRoute} />
              </div>
            )}
            {activeRoute === 'landing' && !isAuthenticated && <AuthLanding onNavigate={setRoute} />}
            {activeRoute === 'login' && <ConsumerLogin onNavigate={setRoute} />}
            {activeRoute === 'signup' && <ConsumerSignup onNavigate={setRoute} />}
            {activeRoute === 'forgot-password' && <ForgotPassword onNavigate={setRoute} />}
            {activeRoute === 'first-get-prompt' && <FirstGetPrompt onNavigate={setRoute} />}
            {activeRoute === 'ranks' && <LeaderboardScreen onNavigate={setRoute} />}
            {activeRoute === 'feed' && <FeedScreen onNavigate={setRoute} />}
            {activeRoute === 'friends' && <FriendsScreen />}
            {activeRoute === 'profile' && <ProfileScreen onNavigate={setRoute} />}
            {activeRoute === 'privacy' && <PrivacySettingsScreen onNavigate={setRoute} />}
            {activeRoute === 'notifications' && <NotificationCenter onNavigate={setRoute} />}
            {activeRoute === 'notification-settings' && <NotificationSettings onNavigate={setRoute} />}
            {activeRoute === 'history' && <CheckInHistoryScreen onNavigate={setRoute} />}
          </>
        )}
      </div>
      <BottomNav
        active={activeRoute}
        onNavigate={setRoute}
        onReselect={(route) => {
          // Re-tapping Map while on the Map screen toggles the Peek_Carousel.
          if (route === 'map') useSelectionStore.getState().toggleOpen()
        }}
      />
    </div>
  )
}
