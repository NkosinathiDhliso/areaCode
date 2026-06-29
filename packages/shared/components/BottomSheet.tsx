import { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useToastStore } from '../stores/toastStore'
import { Box } from './primitives'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  /**
   * When true, the backdrop is rendered with a lighter dim so the map
   * (or other underlying content) stays visible behind the sheet. Used by
   * the Gets-to-map redirect so that pulsing neighbour venues stay in
   * peripheral vision while the user reads the focused venue's details.
   */
  transparentBackdrop?: boolean
}

export function BottomSheet({ isOpen, onClose, children, transparentBackdrop = false }: BottomSheetProps) {
  const setBottomSheetOpen = useToastStore((s) => s.setBottomSheetOpen)
  const backdropMouseDownRef = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setBottomSheetOpen(isOpen)
    return () => setBottomSheetOpen(false)
  }, [isOpen, setBottomSheetOpen])

  // Focus trap (Issue #8)
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !sheetRef.current) return

      const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    // Focus the first focusable element
    requestAnimationFrame(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    })

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      backdropMouseDownRef.current = true
    }
  }, [])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && backdropMouseDownRef.current) {
        onClose()
      }
      backdropMouseDownRef.current = false
    },
    [onClose],
  )

  if (!isOpen) return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop overlay */}
      <Box
        className={`absolute inset-0 ${transparentBackdrop ? 'bg-[rgba(8,10,14,0.25)]' : 'bg-[var(--bg-overlay)]'}`}
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
        role="presentation"
      />
      {/* Sheet panel, positioned above the nav bar */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        style={{
          position: 'relative',
          // The nav bar's real height is nav-height + the bottom safe-area
          // inset (home indicator). Matching that here keeps the sheet's
          // bottom content - primary CTAs especially - clear of the nav on
          // notched devices and iOS Safari PWAs. Without the inset, the last
          // ~34px of the sheet was hidden behind the nav.
          marginBottom: 'calc(var(--nav-height, 56px) + env(safe-area-inset-bottom, 0px))',
          maxHeight: '70dvh',
          overflowY: 'auto',
          animation: 'slideUp 300ms cubic-bezier(0.2,0.8,0.2,1) forwards',
        }}
        className="bg-[var(--bg-modal)] rounded-t-3xl px-5 pt-5 pb-6 shadow-[0_-4px_30px_rgba(0,0,0,0.5)] border-t border-[rgba(255,255,255,0.1)]"
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
