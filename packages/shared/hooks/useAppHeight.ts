import { useEffect } from 'react'

/**
 * Pins a `--app-height` CSS variable to the actually-visible viewport height.
 *
 * Why this exists: on iOS Safari (and some Android browsers) `100vh` and even
 * `100dvh` do not reliably equal the visible area in every state - installed
 * standalone PWAs, the toolbar mid-transition, and older WebKit can all leave
 * the app shell shorter than the screen, exposing a strip of the page backstop
 * below the bottom nav. `window.innerHeight` always reports the real visible
 * layout height, so we mirror it into a CSS variable and let the shell size off
 * that (`height: var(--app-height, 100dvh)`), with `100dvh` as the SSR / no-JS
 * fallback. Updated on resize and orientation changes.
 *
 * Single source of truth: call this once at the app root. The shell and any
 * full-screen surface read the same `--app-height` variable.
 */
export function useAppHeight(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const root = document.documentElement
    const setHeight = () => {
      root.style.setProperty('--app-height', `${window.innerHeight}px`)
    }

    setHeight()
    window.addEventListener('resize', setHeight)
    window.addEventListener('orientationchange', setHeight)
    // visualViewport fires as the iOS Safari toolbar expands/collapses, which a
    // plain resize listener can miss.
    window.visualViewport?.addEventListener('resize', setHeight)

    return () => {
      window.removeEventListener('resize', setHeight)
      window.removeEventListener('orientationchange', setHeight)
      window.visualViewport?.removeEventListener('resize', setHeight)
    }
  }, [])
}
