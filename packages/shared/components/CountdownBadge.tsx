import { useEffect, useState } from 'react'

/**
 * Compact "Expires in X" badge used on reward cards.
 *
 * Tone:
 *   - hidden:    expiresAt is null OR more than 7 days away
 *   - yellow:    < 7 days
 *   - red:       < 24 hours
 *   - "Missed":  expiresAt is in the past
 *
 * Re-renders once a minute so a "1h" doesn't sit on the screen for
 * 60 minutes. We intentionally don't tick every second - that's noisy.
 */

export interface CountdownBadgeProps {
  expiresAt: string | null | undefined
  className?: string
  /** Optional override for "now" - used in tests */
  nowMs?: number
}

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Missed'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`
  return `${Math.round(ms / DAY)}d`
}

function tone(ms: number): 'hidden' | 'yellow' | 'red' | 'expired' {
  if (ms <= 0) return 'expired'
  if (ms < DAY) return 'red'
  if (ms < 7 * DAY) return 'yellow'
  return 'hidden'
}

export function CountdownBadge({ expiresAt, className = '', nowMs }: CountdownBadgeProps) {
  const [now, setNow] = useState(nowMs ?? Date.now())

  useEffect(() => {
    if (nowMs !== undefined) return // test mode
    const id = setInterval(() => setNow(Date.now()), MIN)
    return () => clearInterval(id)
  }, [nowMs])

  if (!expiresAt) return null
  const remaining = Date.parse(expiresAt) - now
  const t = tone(remaining)
  if (t === 'hidden') return null

  const cls =
    t === 'red'
      ? 'bg-[var(--danger)]/15 text-[var(--danger)]'
      : t === 'yellow'
        ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
        : 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]'

  return (
    <span
      data-testid="countdown-badge"
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cls} ${className}`}
    >
      {t === 'expired' ? 'Missed' : `Expires in ${formatRemaining(remaining)}`}
    </span>
  )
}
