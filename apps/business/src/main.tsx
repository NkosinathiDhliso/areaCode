import React from 'react'
import ReactDOM from 'react-dom/client'

import { installPreloadErrorHandler } from '@area-code/shared/lib/preloadErrorHandler'
import { App } from './App'
import './i18n'
import './app.css'

installPreloadErrorHandler()

async function bootstrap() {
  try {
    const { initRum } = await import('@area-code/shared/lib/rum')
    await initRum()
  } catch {
    // RUM init failed - app continues without monitoring
  }

  if (import.meta.env.VITE_DEV_MOCK === 'true') {
    const { initDevMocks, getDevMockSocket, startBusinessEmitter } = await import('@area-code/shared/mocks')
    await initDevMocks()
    const sock = getDevMockSocket()
    if (sock) startBusinessEmitter(sock)
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
