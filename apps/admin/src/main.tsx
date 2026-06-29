import React from 'react'
import ReactDOM from 'react-dom/client'

import { installPreloadErrorHandler } from '@area-code/shared/lib/preloadErrorHandler'
import { installDomReconciliationGuard } from '@area-code/shared/lib/domReconciliationGuard'
import { App } from './App'
import './i18n'
import './app.css'

installDomReconciliationGuard()
installPreloadErrorHandler()

async function bootstrap() {
  try {
    const { initRum } = await import('@area-code/shared/lib/rum')
    await initRum()
  } catch {
    // RUM init failed - app continues without monitoring
  }

  if (import.meta.env.VITE_DEV_MOCK === 'true') {
    const { initDevMocks } = await import('@area-code/shared/mocks')
    await initDevMocks()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
