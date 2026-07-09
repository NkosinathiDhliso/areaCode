import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'

import 'mapbox-gl/dist/mapbox-gl.css'

import { installPreloadErrorHandler } from '@area-code/shared/lib/preloadErrorHandler'
import { installDomReconciliationGuard } from '@area-code/shared/lib/domReconciliationGuard'

import { App } from './App'
import './i18n'
import './app.css'

// Make DOM mutation resilient to browser translation / extensions that move
// text nodes out from under React, which otherwise crashes the whole tree with
// a NotFoundError in insertBefore. Must run before the React root renders.
installDomReconciliationGuard()
installPreloadErrorHandler()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      // Don't throw errors to the error boundary for failed queries
      // Instead, components handle loading/error states gracefully
      throwOnError: false,
    },
    mutations: {
      retry: 1,
      throwOnError: false,
    },
  },
})

async function bootstrap() {
  // Error monitoring is fire-and-forget: never let a slow or failed RUM chunk
  // download delay first paint (a blank screen on slow mobile networks).
  void import('@area-code/shared/lib/rum')
    .then(({ initRum }) => initRum())
    .catch(() => {
      // RUM init failed - app continues without monitoring
    })

  if (import.meta.env.VITE_DEV_MOCK === 'true') {
    try {
      const { initDevMocks } = await import('@area-code/shared/mocks')
      await initDevMocks()
    } catch {
      // Dev mocks not available, continue without them
    }
  }

  const root = document.getElementById('root')
  if (!root) {
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100dvh;color:#e5e5e5;font-family:system-ui">Could not start the app. Please reload.</div>'
    return
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  )

  // Register the service worker (Web Push + offline shell) and wire its update
  // lifecycle. Without this, an installed PWA serves the precached shell forever
  // and never picks up a new deploy - the cause of "prod looks stale, dev is
  // fine". A standalone PWA (esp. iOS) resumes its old page instead of doing a
  // fresh navigation, so we drive updates explicitly.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    registerServiceWorker()
  }
}

function registerServiceWorker() {
  // Reload once when a new worker takes control so the page runs the new build.
  // Skip the initial claim on first install (no prior controller) to avoid an
  // unwanted first-load reload.
  let refreshing = false
  const hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return
    refreshing = true
    window.location.reload()
  })

  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      // When a newly-found worker finishes installing while an old one still
      // controls the page, tell it to activate now (sw.js handles SKIP_WAITING).
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            installing.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })

      // Check for a new build on launch and each time the PWA returns to the
      // foreground - the only reliable update trigger for an iOS standalone app
      // that resumes without navigating.
      const checkForUpdate = () => void registration.update().catch(() => undefined)
      checkForUpdate()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
    })
    .catch(() => {
      // SW registration failed - push notifications won't work but app is fine
    })
}

void bootstrap().catch(() => {
  // Last resort - if bootstrap itself fails, show a minimal error
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100dvh;background:#0a0a0a;color:#e5e5e5;font-family:system-ui;padding:24px;text-align:center"><div style="font-size:48px;margin-bottom:16px">📍</div><h1 style="font-size:20px;font-weight:700;margin-bottom:8px">Area Code</h1><p style="font-size:14px;color:#a3a3a3;margin-bottom:24px;max-width:280px">Something went wrong loading the app. Please check your connection and reload.</p><button onclick="location.reload()" style="background:#778CA9;color:#fff;font-weight:600;border-radius:12px;padding:14px 32px;font-size:15px;border:none;cursor:pointer">Reload</button></div>'
  }
})
