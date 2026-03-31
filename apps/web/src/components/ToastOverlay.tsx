import { useEffect, useRef } from 'react'
import { useToastStore } from '@area-code/shared/stores/toastStore'
import { LiveToast } from '@area-code/shared/components/LiveToast'

export function ToastOverlay() {
  const { queue, isBottomSheetOpen, removeToast } = useToastStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentToast = queue[0]

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    if (!currentToast) return
    timerRef.current = setTimeout(() => {
      removeToast(currentToast.id)
    }, 4000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [currentToast, removeToast])

  // Hidden when bottom sheet is open
  if (isBottomSheetOpen || !currentToast) return null

  return (
    <div
      className="absolute left-4 right-4"
      style={{ bottom: 'calc(var(--nav-height) + 8px)' }}
    >
      <LiveToast toast={currentToast} onDismiss={removeToast} />
    </div>
  )
}
