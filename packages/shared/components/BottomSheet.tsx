import { useEffect, type ReactNode } from 'react'

import { useToastStore } from '../stores/toastStore'
import { Box } from './primitives'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
}

export function BottomSheet({ isOpen, onClose, children }: BottomSheetProps) {
  const setBottomSheetOpen = useToastStore((s) => s.setBottomSheetOpen)

  useEffect(() => {
    setBottomSheetOpen(isOpen)
    return () => setBottomSheetOpen(false)
  }, [isOpen, setBottomSheetOpen])

  if (!isOpen) return null

  return (
    <Box className="fixed inset-0 z-50 flex flex-col justify-end">
      <Box
        className="absolute inset-0 bg-[var(--bg-overlay)]"
        onClick={onClose}
        role="presentation"
      />
      <Box className="relative bg-[var(--bg-surface)] rounded-t-3xl px-5 pt-5 pb-8 max-h-[85dvh] overflow-y-auto animate-[slideUp_300ms_cubic-bezier(0.2,0.8,0.2,1)_forwards]">
        <Box className="flex justify-center mb-4">
          <Box className="w-10 h-1 rounded-full bg-[var(--border-strong)]" />
        </Box>
        {children}
      </Box>
    </Box>
  )
}
