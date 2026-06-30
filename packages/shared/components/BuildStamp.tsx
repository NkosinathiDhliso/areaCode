declare const __APP_BUILD_ID__: string | undefined

/**
 * On-device build stamp for diagnosing stale installs. The id is injected at
 * build time via each app's vite `define` (__APP_BUILD_ID__): commit hash plus
 * UTC build time. Fixed, dim, and non-interactive so it never blocks UI. Read
 * it on the device to confirm which build is actually running; remove this once
 * stale-build debugging is done.
 */
export function BuildStamp() {
  const id = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'dev'
  return (
    <div
      aria-hidden="true"
      className="fixed left-1 top-0 z-[9998] pointer-events-none select-none font-mono text-[9px] leading-none"
      style={{
        color: 'var(--text-muted)',
        opacity: 0.45,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2px)',
      }}
    >
      {id}
    </div>
  )
}
