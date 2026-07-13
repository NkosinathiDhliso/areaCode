import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  retryCount: number
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console in dev, silently report in prod.
    // Read `import.meta.env` defensively: the shared tsconfig doesn't include
    // Vite client types, so access it via a cast (mirrors lib/featureGating.ts)
    // and guard so non-Vite contexts (RN, Node tests) don't throw.
    let isDev = false
    try {
      // Plain member access so Vite replaces `import.meta.env` at build time.
      // The `(import.meta)?.env` form is not replaced and reads undefined.
      const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env
      isDev = env?.DEV === true
    } catch {
      // import.meta unavailable - assume prod.
    }
    if (isDev) {
      console.error('[ErrorBoundary] Unhandled error:', error, errorInfo)
    }
    // Try to report to Sentry if available
    try {
      const w = window as unknown as Record<string, unknown>
      if (typeof w['__SENTRY__'] !== 'undefined') {
        ;(w as Record<string, { captureException?: (e: Error) => void }>)['Sentry']?.captureException?.(error)
      }
    } catch {
      // Sentry not available, that's fine
    }
  }

  handleRetry = (): void => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }))
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // After 2 retries, suggest a full reload instead
      const showReloadOnly = this.state.retryCount >= 2

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100dvh',
            padding: '24px',
            backgroundColor: 'var(--bg-base, #0a0a0a)',
            color: 'var(--text-primary, #e5e5e5)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Friendly icon */}
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📍</div>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: '700',
              marginBottom: '8px',
              textAlign: 'center',
            }}
          >
            {showReloadOnly ? 'Still having trouble' : 'Something went wrong'}
          </h1>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary, #a3a3a3)',
              marginBottom: '24px',
              textAlign: 'center',
              maxWidth: '300px',
              lineHeight: '1.5',
            }}
          >
            {showReloadOnly
              ? "Let's start fresh. This won't affect your account or data."
              : "No worries - this happens sometimes. Let's get you back on the map."}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '280px' }}>
            {!showReloadOnly && (
              <button
                onClick={this.handleRetry}
                style={{
                  backgroundColor: 'var(--accent, #778CA9)',
                  color: '#fff',
                  fontWeight: '600',
                  borderRadius: '12px',
                  padding: '14px 32px',
                  fontSize: '15px',
                  border: 'none',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                Try again
              </button>
            )}
            <button
              onClick={this.handleReload}
              style={{
                backgroundColor: showReloadOnly ? 'var(--accent, #778CA9)' : 'transparent',
                color: showReloadOnly ? '#fff' : 'var(--text-secondary, #a3a3a3)',
                fontWeight: '600',
                borderRadius: '12px',
                padding: '14px 32px',
                fontSize: '15px',
                border: showReloadOnly ? 'none' : '1px solid var(--border, #333)',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              {showReloadOnly ? 'Reload app' : 'Reload page'}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
