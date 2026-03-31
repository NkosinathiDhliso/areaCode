import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import 'mapbox-gl/dist/mapbox-gl.css'

import { App } from './App'
import './i18n'
import './app.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
  },
})

async function bootstrap() {
  if (import.meta.env.VITE_DEV_MOCK === 'true') {
    const { initDevMocks } = await import('@area-code/shared/mocks')
    await initDevMocks()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
