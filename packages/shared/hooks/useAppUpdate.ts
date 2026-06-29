import { useCallback, useState } from 'react'

/**
 * Forces an installed PWA / cached browser session to pull the latest deploy.
 *
 * Why this is needed: the service worker (`apps/web/public/sw.js`) precaches
 * the app shell and serves same-origin static assets cache-first. A chrome-less
 * standalone PWA on iOS often resumes its existing page instead of doing a
 * fresh navigation, so users can sit on stale code long after a new build is
 * live. There's no browser refresh button to bail them out, hence this.
 *
 * What it does, in order:
 *   1. Asks the active service worker registration to re-check `sw.js`
 *      (`registration.update()`), and tells any worker that's waiting to take
 *      over now (`SKIP_WAITING`, handled in sw.js).
 *   2. Clears the runtime caches so cache-first assets are re-fetched.
 *   3. Reloads. The SW serves navigations network-first, so the reload pulls
 *      fresh HTML, which references the new fingerprinted asset URLs.
 *
 * Reused across portals via the shared hooks barrel. Call it from a settings
 * "Check for updates" control.
 */
export function useAppUpdate() {
  const [updating, setUpdating] = useState(false)

  const updateApp = useCallback(async () => {
    setUpdating(true)
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        if (reg) {
          try {
            await reg.update()
          } catch {
            /* update check failed - still fall through to cache clear + reload */
          }
          // If a fresh worker is parked in "waiting", let it activate now.
          reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
        }
      }

      if (typeof caches !== 'undefined') {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {
      /* best-effort - a plain reload below is still worthwhile */
    } finally {
      // Network-first navigation in the SW means this pulls the latest shell.
      window.location.reload()
    }
  }, [])

  return { updating, updateApp }
}
