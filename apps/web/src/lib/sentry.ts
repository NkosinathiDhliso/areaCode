/**
 * Frontend error monitoring via Sentry.
 * Setup: npm install @sentry/react
 * Config: Set VITE_SENTRY_DSN env var.
 *
 * Gracefully degrades if @sentry/react is not installed.
 */

let initialized = false

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SentryModule: Record<string, any> | null = null

export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return

  try {
    // Dynamic import — won't fail the build if package is missing
    const mod = await (new Function('return import("@sentry/react")')() as Promise<Record<string, unknown>>)
    SentryModule = mod as Record<string, any>
    SentryModule['init']({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    })
    initialized = true

    window.addEventListener('unhandledrejection', (event) => {
      SentryModule?.['captureException']?.(event.reason)
    })
  } catch {
    // @sentry/react not installed — monitoring disabled, app runs fine
  }
}

export function captureError(err: unknown): void {
  if (!initialized || !SentryModule) return
  SentryModule['captureException']?.(err)
}

export function isInitialized(): boolean {
  return initialized
}
