import { useRef } from 'react'

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
 * Motion (magic on intent): the chip rises a few pixels and settles as it
 * appears, and eases back down as it leaves - a crafted moment, not a flat
 * opacity pop. The last copy is held through the fade-out so the text never
 * blanks before the chip has gone. Honours `prefers-reduced-motion` (instant
 * show/hide, no transform).
 *
 * Accessible: aria-live="polite" announces to screen readers without
 * interrupting. Not interactive (no tap action, pointer-events none).
 */
export function WhisperChip({ text }: WhisperChipProps) {
  const animate = !reducedMotion()
  const visible = text != null && text !== ''
  // Retain the last non-null copy so it stays legible during the exit fade
  // instead of collapsing to an empty chip the instant the sweep ends. Assigned
  // during render (no state, no effect) so a new copy costs zero extra renders.
  const lastShown = useRef<string | null>(null)
  if (visible) lastShown.current = text

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
          opacity: visible ? 1 : 0,
          transform: animate ? (visible ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.96)') : 'none',
          transformOrigin: 'center bottom',
          // Drop the backdrop-blur layer out of compositing once the chip is
          // gone so the GPU stops blending it over the WebGL canvas. Delay the
          // hide until the 180ms fade finishes (0ms delay on show) so it never
          // clips the exit animation. Reduced motion toggles instantly.
          visibility: visible ? 'visible' : 'hidden',
          transition: animate
            ? `opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 220ms cubic-bezier(0.16, 1, 0.3, 1), visibility 0s ${visible ? '0ms' : '180ms'}`
            : 'none',
        }}
      >
        {text ?? lastShown.current ?? ''}
      </div>
    </div>
  )
}
