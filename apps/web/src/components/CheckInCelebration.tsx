import { haptic, prefersReducedMotion } from '@area-code/shared/lib/haptics'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * `CheckInCelebration` - the peak-end reward moment for a successful check-in.
 *
 * The check-in is the app's core action; before this, success ended in silence
 * (the sheet just closed). This surfaces a brief, non-blocking celebration that
 * animates the venue's Live_Check_In_Count up by the user's own arrival,
 * confirms their new check-in total, and shows their current night streak.
 *
 * Honesty (honest-presence.md): every number shown is real. The +1 to the live
 * count reflects the user who genuinely just checked in (GPS/QR proven); the
 * total is their real incremented total; the streak is their existing streak.
 * Nothing here claims activity that did not happen.
 *
 * Non-blocking and self-dismissing: it renders over the map with
 * `pointer-events: none`, auto-dismisses after ~2.6s, and honours
 * `prefers-reduced-motion` (no count-up tween, no scale/ripple animation).
 */
export interface CheckInCelebrationProps {
  venueName: string
  /** Live count before the user's own arrival. */
  fromCount: number
  /** Live count after the user's own arrival (fromCount + 1). */
  toCount: number
  /** The user's new total check-ins. */
  totalCheckIns: number
  /** The user's current night streak (0 when none). */
  streakCount: number
  /** Called when the moment has run its course. */
  onDone: () => void
}

const VISIBLE_MS = 2600
const COUNT_UP_MS = 700

/** Tween an integer from → to over durationMs. Instant when disabled. */
function useCountUp(from: number, to: number, durationMs: number, animate: boolean): number {
  const [value, setValue] = useState(animate ? from : to)

  useEffect(() => {
    if (!animate) {
      setValue(to)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      // easeOutCubic for a count that decelerates into place
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(from + (to - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [from, to, durationMs, animate])

  return value
}

export function CheckInCelebration({
  venueName,
  fromCount,
  toCount,
  totalCheckIns,
  streakCount,
  onDone,
}: CheckInCelebrationProps) {
  const { t } = useTranslation()
  const reduced = prefersReducedMotion()
  const count = useCountUp(fromCount, toCount, COUNT_UP_MS, !reduced)
  const firedRef = useRef(false)

  // A single celebratory haptic tick (no-ops on iOS PWA and reduced-motion).
  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    haptic([12, 40, 12])
  }, [])

  // Auto-dismiss.
  useEffect(() => {
    const id = window.setTimeout(onDone, VISIBLE_MS)
    return () => window.clearTimeout(id)
  }, [onDone])

  const hereNow = t('venueCard.hereNow', 'here now')
  const streakLabel = t('checkin.celebrate.streak', '{{count}}-night streak', { count: streakCount })
  const totalLabel = t('checkin.celebrate.total', '{{count}} check-ins', { count: totalCheckIns })

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[10001] flex items-center justify-center px-8"
      role="status"
      aria-live="polite"
    >
      <div
        className="glass-raised flex flex-col items-center gap-3 rounded-2xl px-8 py-7 text-center"
        style={{ animation: reduced ? undefined : 'popIn 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards' }}
      >
        {/* Pulsing confirmation ring. The ripple is decorative and hidden from
            assistive tech; the spoken confirmation lives in the text below. */}
        <div className="relative flex h-16 w-16 items-center justify-center">
          {!reduced && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full"
              style={{ background: 'var(--accent)', opacity: 0.25, animation: 'ripple 1200ms ease-out forwards' }}
            />
          )}
          <span
            className="relative flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-cta)' }}
          >
            <Check size={30} strokeWidth={2.5} className="text-[var(--on-accent)]" />
          </span>
        </div>

        <div>
          <p className="font-[Syne] text-lg font-bold text-[var(--text-primary)]">
            {t('checkin.celebrate.title', "You're in")}
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{venueName}</p>
        </div>

        {/* Live count: the honest, animated payoff. The user's own arrival is
            the reason the number moved. */}
        <p className="text-sm font-medium text-[var(--text-primary)]">
          <span className="font-bold tabular-nums">{count}</span>{' '}
          <span className="text-[var(--text-secondary)]">{hereNow}</span>
        </p>

        {/* Secondary progress cues (goal-gradient + streak). Shown only when
            they carry a real value. */}
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>{totalLabel}</span>
          {streakCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{streakLabel}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
