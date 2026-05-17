import React from 'react'
import ReactDOM from 'react-dom/client'

import { installPreloadErrorHandler } from '@area-code/shared/lib/preloadErrorHandler'
import { App } from './App'
import './i18n'
import './app.css'

installPreloadErrorHandler()

async function bootstrap() {
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
