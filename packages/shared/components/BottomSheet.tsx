import { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useToastStore } from '../stores/toastStore'
import { Box } from './primitives'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
}

export function BottomSheet({ isOpen, onClose, children }: BottomSheetProps) {
  const setBottomSheetOpen = useToastStore((s) => s.setBottomSheetOpen)
  const backdropMouseDownRef = useRef(false)

  useEffect(() => {
    setBottomSheetOpen(isOpen)
    return () => setBottomSheetOpen(false)
  }, [isOpen, setBottomSheetOpen])

  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      backdropMouseDownRef.current = true
    }
  }, [])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && backdropMouseDownRef.current) {
      onClose()
    }
    backdropMouseDownRef.current = false
  }, [onClose])

  if (!isOpen) return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {/* Backdrop overlay */}
      <Box
        className="absolute inset-0 bg-[var(--bg-overlay)]"
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
        role="presentation"
      />
      {/* Sheet panel — positioned above the nav bar */}
      <div
        style={{
          position: 'relative',
          marginBottom: 'var(--nav-height, 56px)',
          maxHeight: '70dvh',
          overflowY: 'auto',
          animation: 'slideUp 300ms cubic-bezier(0.2,0.8,0.2,1) forwards',
        }}
        className="bg-[var(--bg-raised)] rounded-t-3xl px-5 pt-5 pb-6 shadow-[0_-4px_30px_rgba(0,0,0,0.5)] border-t border-[rgba(255,255,255,0.1)]"
      >
        <Box className="flex justify-center mb-4">
          <Box className="w-10 h-1 rounded-full bg-[var(--border-strong)]" />
        </Box>
        {children}
      </div>
    </div>,
    document.body,
  )
}
