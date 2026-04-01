/**
 * Sentry error monitoring integration.
 * Captures unhandled errors, Fastify request errors, and manual reports.
 *
 * Setup: npm install @sentry/node
 * Config: Set SENTRY_DSN env var in production.
 */

let sentryInitialized = false

interface SentryLike {
  init: (opts: Record<string, unknown>) => void
  captureException: (err: unknown, context?: Record<string, unknown>) => void
  captureMessage: (msg: string, level?: string) => void
  setTag: (key: string, value: string) => void
  setUser: (user: { id: string } | null) => void
}

let Sentry: SentryLike | null = null

export async function initSentry(): Promise<void> {
  const dsn = process.env['SENTRY_DSN']
  if (!dsn) return

  try {
    const mod = await import('@sentry/node')
    Sentry = mod as unknown as SentryLike

    Sentry.init({
      dsn,
      environment: process.env['AREA_CODE_ENV'] ?? 'unknown',
      tracesSampleRate: process.env['AREA_CODE_ENV'] === 'prod' ? 0.1 : 1.0,
      release: `area-code-api@${process.env['GIT_SHA'] ?? '0.0.1'}`,
    })

    sentryInitialized = true
  } catch {
    // Sentry package not installed — monitoring disabled
    process.stderr.write('[sentry] @sentry/node not installed, monitoring disabled\n')
  }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryInitialized || !Sentry) return
  Sentry.captureException(err, context ? { extra: context } as Record<string, unknown> : undefined)
}

export function captureMessage(msg: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!sentryInitialized || !Sentry) return
  Sentry.captureMessage(msg, level)
}

export function setUser(userId: string | null): void {
  if (!sentryInitialized || !Sentry) return
  Sentry.setUser(userId ? { id: userId } : null)
}

export function isInitialized(): boolean {
  return sentryInitialized
}
