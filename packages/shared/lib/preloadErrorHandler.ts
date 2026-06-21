/**
 * Handles `vite:preloadError` events that fire when a dynamically imported
 * module (a code-split chunk) fails to download. This almost always means the
 * tab has stale `index.html` referencing chunk filenames from a previous
 * deploy whose hashed assets have been replaced on the CDN.
 *
 * Strategy: on the first such error per tab session, force a single hard
 * reload so the user fetches the new HTML and the new chunk hashes. Guarded
 * with `sessionStorage` so we don't loop reload if the failure is something
 * else (network down, asset missing in the new build, etc.).
 *
 * Background: https://vitejs.dev/guide/build.html#load-error-handling
 */

const SESSION_KEY = '__ac_chunk_reload_attempted__'

export function installPreloadErrorHandler(): void {
  if (typeof window === 'undefined') return

  const reloadOnce = (reason: string) => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') {
        // Already reloaded once this session - don't loop. The new build
        // is genuinely missing this chunk; let the error surface.
        // eslint-disable-next-line no-console
        console.error('[preloadErrorHandler] reload already attempted, not retrying:', reason)
        return
      }
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      // sessionStorage may be unavailable (private mode, quota). Reload anyway.
    }
    // eslint-disable-next-line no-console
    console.warn('[preloadErrorHandler] stale chunk detected, reloading:', reason)
    window.location.reload()
  }

  // Vite's dedicated event for preload failures of code-split chunks.
  window.addEventListener('vite:preloadError', (event) => {
    const ev = event as Event & { payload?: { message?: string } }
    reloadOnce(ev.payload?.message ?? 'vite:preloadError')
  })

  // Belt-and-braces for runtime dynamic imports that bypass the preload path
  // (e.g. lazy() chunks fetched after initial paint). The error message shape
  // is stable across browsers for fetch-based ESM module loading failures.
  window.addEventListener('error', (event) => {
    const msg = event.message || ''
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('error loading dynamically imported module') ||
      msg.includes('Importing a module script failed')
    ) {
      reloadOnce(msg)
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const msg = typeof reason === 'string' ? reason : (reason?.message ?? '')
    if (
      typeof msg === 'string' &&
      (msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('error loading dynamically imported module') ||
        msg.includes('Importing a module script failed'))
    ) {
      reloadOnce(msg)
    }
  })
}
