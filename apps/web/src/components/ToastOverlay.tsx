import { useEffect, useRef, useState, useCallback } from 'react'
import { useToastStore } from '@area-code/shared/stores/toastStore'
import { LiveToast } from '@area-code/shared/components/LiveToast'

export function ToastOverlay() {
  const { queue, isBottomSheetOpen, removeToast } = useToastStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [translateX, setTranslateX] = useState(0)

  const currentToast = queue[0]

  // Auto-dismiss after 5 seconds (increased from 4 for readability)
  useEffect(() => {
    if (!currentToast) return
    timerRef.current = setTimeout(() => {
      removeToast(currentToast.id)
    }, 5000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [currentToast, removeToast])

  // Swipe-to-dismiss handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartX(e.touches[0]?.clientX ?? null)
  }, [])

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX === null) return
      const diff = (e.touches[0]?.clientX ?? 0) - touchStartX
      setTranslateX(diff)
    },
    [touchStartX],
  )

  const handleTouchEnd = useCallback(() => {
    if (Math.abs(translateX) > 80 && currentToast) {
      removeToast(currentToast.id)
    }
    setTouchStartX(null)
    setTranslateX(0)
  }, [translateX, currentToast, removeToast])

  // Hidden when bottom sheet is open
  if (!currentToast) return null

  return (
    <div
      className="fixed left-4 right-4"
      style={{
        bottom: 'calc(var(--nav-height, 56px) + 8px)',
        zIndex: isBottomSheetOpen ? 10000 : 9998,
        transform: `translateX(${translateX}px)`,
        opacity: Math.max(0, 1 - Math.abs(translateX) / 120),
        transition: touchStartX !== null ? 'none' : 'transform 200ms, opacity 200ms',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <LiveToast toast={currentToast} onDismiss={removeToast} />
    </div>
  )
}
