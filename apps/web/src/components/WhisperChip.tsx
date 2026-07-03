import { reducedMotion } from '../lib/reducedMotion'

interface WhisperChipProps {
  text: string | null
}

/**
 * Screen-anchored magnet whisper chip for constellation sweep.
 *
 * Shows the one-line magnet copy (belonging/momentum/aliveness) when a
 * beam is brushed. Reuses toast styling tokens: rounded-2xl, glass
 * background, small text. Dismisses automatically when the sweep ends
 * (text becomes null).
 *
 * Accessible: aria-live="polite" announces to screen readers without
 * interrupting. Not interactive (no tap action, pointer-events none).
 */
export function WhisperChip({ text }: WhisperChipProps) {
  const animate = !reducedMotion()

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
      style={{ bottom: 'calc(var(--nav-height, 56px) + 80px)' }}
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="rounded-2xl px-4 py-2 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap"
        style={{
          background: 'var(--glass-bg, rgba(0, 0, 0, 0.6))',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.1))',
          opacity: text ? 1 : 0,
          transition: animate ? 'opacity 150ms ease' : 'none',
        }}
      >
        {text ?? ''}
      </div>
    </div>
  )
}
