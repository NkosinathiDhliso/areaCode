import type { Toast } from '../types'
import { Box, Row, Text } from './primitives'

interface LiveToastProps {
  toast: Toast
  onDismiss: (id: string) => void
}

export function LiveToast({ toast, onDismiss }: LiveToastProps) {
  return (
    <Row
      className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 items-center gap-3 shadow-lg animate-[slideInRight_300ms_cubic-bezier(0.2,0.8,0.2,1)_forwards]"
      onClick={() => onDismiss(toast.id)}
      role="status"
      aria-live="polite"
    >
      {toast.avatarUrl && (
        <img src={toast.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
      )}
      <Text className="text-[var(--text-primary)] text-sm flex-1">{toast.message}</Text>
    </Row>
  )
}
