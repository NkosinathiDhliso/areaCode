import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Unhandled error:', error, errorInfo)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100dvh',
            padding: '20px',
            backgroundColor: 'var(--bg-base, #0a0a0a)',
            color: 'var(--text-primary, #e5e5e5)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <h1
            style={{
              fontSize: '24px',
              fontWeight: '700',
              marginBottom: '12px',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary, #a3a3a3)',
              marginBottom: '24px',
              textAlign: 'center',
              maxWidth: '320px',
            }}
          >
            An unexpected error occurred. Please reload the page to try again.
          </p>
          {this.state.error && (
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-muted, #737373)',
                marginBottom: '24px',
                textAlign: 'center',
                maxWidth: '400px',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleReload}
            style={{
              backgroundColor: 'var(--accent, #778CA9)',
              color: '#fff',
              fontWeight: '600',
              borderRadius: '12px',
              padding: '12px 32px',
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
