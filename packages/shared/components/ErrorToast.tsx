import { useState, useEffect, useCallback } from 'react'

interface ErrorToastProps {
  message: string
  onRetry?: () => void
  onDismiss?: () => void
  autoDismissMs?: number
}

export function ErrorToast({ message, onRetry, onDismiss, autoDismissMs = 5000 }: ErrorToastProps) {
  const [visible, setVisible] = useState(true)

  const dismiss = useCallback(() => {
    setVisible(false)
    onDismiss?.()
  }, [onDismiss])

  useEffect(() => {
    if (autoDismissMs <= 0) return
    const timer = setTimeout(dismiss, autoDismissMs)
    return () => clearTimeout(timer)
  }, [autoDismissMs, dismiss])

  if (!visible) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        backgroundColor: 'var(--bg-surface, #1a1a1a)',
        border: '1px solid var(--border, #333)',
        borderRadius: '12px',
        padding: '12px 16px',
        maxWidth: '360px',
        width: 'calc(100% - 40px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: '13px',
          color: 'var(--text-primary, #e5e5e5)',
        }}
      >
        {message}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            fontSize: '13px',
            fontWeight: '600',
            color: 'var(--accent, #6366f1)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Retry
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          fontSize: '16px',
          color: 'var(--text-muted, #737373)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 2px',
        }}
      >
        ×
      </button>
    </div>
  )
}
