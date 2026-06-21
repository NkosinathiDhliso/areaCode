import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import 'mapbox-gl/dist/mapbox-gl.css'

import { installPreloadErrorHandler } from '@area-code/shared/lib/preloadErrorHandler'
import { App } from './App'
import './i18n'
import './app.css'

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
  // Initialize error monitoring first (non-blocking)
  try {
    const { initRum } = await import('@area-code/shared/lib/rum')
    await initRum()
  } catch {
    // RUM init failed - app continues without monitoring
  }

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

  // Register service worker for Web Push
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed - push notifications won't work but app is fine
    })
  }
}

void bootstrap().catch(() => {
  // Last resort - if bootstrap itself fails, show a minimal error
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100dvh;background:#0a0a0a;color:#e5e5e5;font-family:system-ui;padding:24px;text-align:center"><div style="font-size:48px;margin-bottom:16px">📍</div><h1 style="font-size:20px;font-weight:700;margin-bottom:8px">Area Code</h1><p style="font-size:14px;color:#a3a3a3;margin-bottom:24px;max-width:280px">Something went wrong loading the app. Please check your connection and reload.</p><button onclick="location.reload()" style="background:#778CA9;color:#fff;font-weight:600;border-radius:12px;padding:14px 32px;font-size:15px;border:none;cursor:pointer">Reload</button></div>'
  }
})
