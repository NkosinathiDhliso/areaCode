import { useEffect, useRef, useState } from 'react'

declare const __APP_BUILD_ID__: string | undefined

/**
 * On-device build + safe-area diagnostic for stale-install and home-indicator
 * debugging. Shows the build id (commit hash + UTC build time, injected via the
 * per-app vite `define` __APP_BUILD_ID__), the live measured safe-area insets
 * (top/bottom in px), and the display mode (pwa = installed standalone, tab =
 * browser).
 *
 * Why measure insets instead of trusting the CSS: on iOS the WebView can report
 * env(safe-area-inset-bottom) as 0 in standalone after a close/reopen or SPA
 * navigation, which is exactly what collapses a bottom bar and exposes the
 * home-indicator strip. Reading the real number on the device tells us whether
 * iOS is giving us the 34px inset at all. Fixed, dim, non-interactive. Remove
 * once this is resolved.
 */
export function BuildStamp() {
  const id = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'dev'
  const topProbe = useRef<HTMLDivElement>(null)
  const bottomProbe = useRef<HTMLDivElement>(null)
  const [insets, setInsets] = useState({ top: 0, bottom: 0 })

  useEffect(() => {
    const measure = () => {
      setInsets({
        top: topProbe.current?.offsetHeight ?? 0,
        bottom: bottomProbe.current?.offsetHeight ?? 0,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [])

  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)

  // Hidden probes: their height resolves to the env() inset, which we read back
  // in px. position:fixed so they map to the real viewport edges.
  const probeStyle = {
    position: 'fixed' as const,
    left: 0,
    width: 0,
    visibility: 'hidden' as const,
    pointerEvents: 'none' as const,
  }

  return (
    <>
      <div ref={topProbe} style={{ ...probeStyle, top: 0, height: 'env(safe-area-inset-top, 0px)' }} />
      <div ref={bottomProbe} style={{ ...probeStyle, bottom: 0, height: 'env(safe-area-inset-bottom, 0px)' }} />
      <div
        aria-hidden="true"
        className="fixed left-1 z-[9998] select-none rounded-md font-mono text-[11px] leading-none"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 2px)',
          color: '#ffffff',
          background: 'rgba(255, 0, 128, 0.85)',
          padding: '4px 6px',
          pointerEvents: 'none',
        }}
      >
        {id} · saB {insets.bottom} saT {insets.top} · {standalone ? 'pwa' : 'tab'}
      </div>
    </>
  )
}
