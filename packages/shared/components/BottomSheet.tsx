import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useToastStore } from '../stores/toastStore'
import { Box } from './primitives'

type SnapPoint = 'half' | 'full'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  snapPoints?: SnapPoint[]
}

const SPRING_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const OPEN_DURATION = 350
const CLOSE_DURATION = 200
const DISMISS_VELOCITY = 300 // px/s

export function BottomSheet({ isOpen, onClose, children, title, snapPoints }: BottomSheetProps) {
  const setBottomSheetOpen = useToastStore((s) => s.setBottomSheetOpen)
  const backdropMouseDownRef = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const [currentSnap, setCurrentSnap] = useState<SnapPoint>('half')
  const [isClosing, setIsClosing] = useState(false)
  const [translateY, setTranslateY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const dragStartTime = useRef(0)
  const titleId = useRef(`sheet-title-${Math.random().toString(36).slice(2, 8)}`)

  // Lock body scroll when open
  useEffect(() => {
    if (!isOpen) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [isOpen])

  useEffect(() => {
    setBottomSheetOpen(isOpen)
    return () => setBottomSheetOpen(false)
  }, [isOpen, setBottomSheetOpen])

  // Store trigger element for focus restoration
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement
    }
  }, [isOpen])

  // Focus trap + Escape
  useEffect(() => {
    if (!isOpen || isClosing) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose()
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
    requestAnimationFrame(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    })

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isClosing]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      setTranslateY(0)
      onClose()
      // Restore focus to trigger element
      if (triggerRef.current && 'focus' in triggerRef.current) {
        ;(triggerRef.current as HTMLElement).focus()
      }
    }, CLOSE_DURATION)
  }, [onClose])

  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      backdropMouseDownRef.current = true
    }
  }, [])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && backdropMouseDownRef.current) {
        handleClose()
      }
      backdropMouseDownRef.current = false
    },
    [handleClose],
  )

  // Swipe-to-dismiss handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    dragStartY.current = touch.clientY
    dragStartTime.current = Date.now()
    setIsDragging(true)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    const touch = e.touches[0]
    if (!touch) return
    const dy = touch.clientY - dragStartY.current
    if (dy > 0) {
      setTranslateY(dy)
    }
  }, [isDragging])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    const touch = e.changedTouches[0]
    if (!touch) { setTranslateY(0); return }

    const dy = touch.clientY - dragStartY.current
    const dt = (Date.now() - dragStartTime.current) / 1000
    const velocity = dy / dt

    if (velocity > DISMISS_VELOCITY || dy > 150) {
      handleClose()
    } else if (snapPoints && snapPoints.length > 1 && dy < -50) {
      // Snap to full if dragging up
      setCurrentSnap('full')
      setTranslateY(0)
    } else {
      setTranslateY(0)
    }
  }, [isDragging, handleClose, snapPoints])

  if (!isOpen && !isClosing) return null

  const snapHeight = snapPoints
    ? currentSnap === 'full' ? '90dvh' : '50dvh'
    : '70dvh'

  const animationStyle: React.CSSProperties = isClosing
    ? {
        transform: `translateY(100%)`,
        opacity: 0,
        transition: `transform ${CLOSE_DURATION}ms ease-out, opacity ${CLOSE_DURATION}ms ease-out`,
      }
    : isDragging
      ? { transform: `translateY(${translateY}px)`, transition: 'none' }
      : {
          transform: 'translateY(0)',
          animation: `sheetSlideUp ${OPEN_DURATION}ms ${SPRING_EASE} forwards`,
        }

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
    >
      {/* Backdrop overlay */}
      <Box
        className="absolute inset-0 bg-[var(--bg-overlay)]"
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
        role="presentation"
        style={{
          opacity: isClosing ? 0 : 1,
          transition: `opacity ${CLOSE_DURATION}ms ease-out`,
        }}
      />
      {/* Sheet panel */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId.current : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'relative',
          maxHeight: snapHeight,
          overflowY: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          ...animationStyle,
        }}
        className="bg-[var(--bg-raised)] rounded-t-3xl px-5 pt-5 pb-6 shadow-[0_-4px_30px_rgba(0,0,0,0.5)] border-t border-[rgba(255,255,255,0.1)]"
      >
        {/* Drag handle */}
        <Box className="flex justify-center mb-4">
          <Box
            className="w-10 h-1 rounded-full bg-[var(--border-strong)]"
            style={{ width: '40px', height: '4px' }}
          />
        </Box>
        {title && (
          <h2 id={titleId.current} className="sr-only">{title}</h2>
        )}
        {children}
      </div>
      <style>{`
        @keyframes sheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  )
}
