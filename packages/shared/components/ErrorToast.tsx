import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface ErrorToastProps {
  message: string
  onRetry?: () => void
  onDismiss?: () => void
  autoDismissMs?: number
}

export function ErrorToast({ message, onRetry, onDismiss, autoDismissMs = 4000 }: ErrorToastProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(true)
  const [swipeX, setSwipeX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)

  const dismiss = useCallback(() => {
    setVisible(false)
    onDismiss?.()
  }, [onDismiss])

  useEffect(() => {
    if (autoDismissMs <= 0) return
    const timer = setTimeout(dismiss, autoDismissMs)
    return () => clearTimeout(timer)
  }, [autoDismissMs, dismiss])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    startX.current = touch.clientX
    setIsDragging(true)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    const touch = e.touches[0]
    if (!touch) return
    setSwipeX(touch.clientX - startX.current)
  }, [isDragging])

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false)
    if (Math.abs(swipeX) > 100) {
      dismiss()
    } else {
      setSwipeX(0)
    }
  }, [swipeX, dismiss])

  if (!visible) return null

  return (
    <div
      role="alert"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="fixed top-4 left-1/2 z-[9999] flex flex-col w-[calc(100%-40px)] max-w-[360px] bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] overflow-hidden animate-toast-slide-in"
      style={{
        transform: `translateX(calc(-50% + ${swipeX}px))`,
        transition: isDragging ? 'none' : 'transform 200ms ease-out',
        opacity: Math.abs(swipeX) > 80 ? 0.5 : 1,
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex-1 text-[var(--text-primary)] text-[var(--font-sm)]">
          {message}
        </span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-[var(--accent)] text-[var(--font-sm)] font-semibold whitespace-nowrap active:scale-95 transition-transform"
          >
            {t('common.retry', 'Retry')}
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label={t('common.dismiss', 'Dismiss')}
          className="text-[var(--text-muted)] text-base active:scale-95 transition-transform px-0.5"
        >
          ×
        </button>
      </div>
      {/* Progress bar */}
      <div className="h-0.5 bg-[var(--border)]">
        <div
          className="h-full bg-[var(--accent)]"
          style={{
            animation: `shrinkWidth ${autoDismissMs}ms linear forwards`,
          }}
        />
      </div>
      <style>{`
        @keyframes shrinkWidth {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  )
}
