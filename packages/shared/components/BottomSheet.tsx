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
   * Only meaningful while {@link modal} is true.
   */
  transparentBackdrop?: boolean
  /**
   * Modal (default): full-screen backdrop that dims and blocks the content
   * behind the sheet, tap-outside dismisses, focus is trapped inside.
   *
   * Non-modal (`modal={false}`): no backdrop, everything above the sheet
   * stays fully interactive (pointer events pass through), and focus is not
   * trapped. Escape still dismisses. Used by the Peek_Carousel Browse strip
   * and Constellation peek, which must never block map play: panning the map
   * with the strip open is what drives the `area` browse scope.
   */
  modal?: boolean
}

export function BottomSheet({
  isOpen,
  onClose,
  children,
  transparentBackdrop = false,
  modal = true,
}: BottomSheetProps) {
  const setBottomSheetOpen = useToastStore((s) => s.setBottomSheetOpen)
  const backdropMouseDownRef = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setBottomSheetOpen(isOpen)
    return () => setBottomSheetOpen(false)
  }, [isOpen, setBottomSheetOpen])

  // Escape-to-dismiss in both modes; focus trap + autofocus only when modal
  // (Issue #8). A non-modal sheet is a persistent surface, not a takeover:
  // trapping Tab or stealing focus would lock keyboard users out of the map
  // controls behind it.
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (!modal) return
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
    if (modal) {
      // Focus the first focusable element
      requestAnimationFrame(() => {
        const first = sheetRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        first?.focus()
      })
    }

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, modal])

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
        // Non-modal: the wrapper spans the viewport for layout only; pointer
        // events pass through to the map. The sheet panel re-enables them.
        pointerEvents: modal ? undefined : 'none',
      }}
    >
      {/* Backdrop overlay (modal only) */}
      {modal && (
        <Box
          className={`absolute inset-0 ${transparentBackdrop ? 'bg-[rgba(8,10,14,0.25)]' : 'bg-[var(--bg-overlay)]'}`}
          onMouseDown={handleBackdropMouseDown}
          onClick={handleBackdropClick}
          role="presentation"
        />
      )}
      {/* Sheet panel, positioned above the nav bar */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={modal ? 'true' : undefined}
        style={{
          position: 'relative',
          pointerEvents: 'auto',
          // Clear the bottom nav so the sheet's bottom content - primary CTAs
          // especially - is not hidden behind it. The nav is a flush bar of
          // height --nav-height with no safe-area padding.
          marginBottom: 'var(--nav-height, 56px)',
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
