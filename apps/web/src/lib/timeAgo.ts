/**
 * Compact relative-time label for "just claimed" social proof and get history.
 * Pure: the caller supplies `nowMs` so it stays deterministic and testable.
 * Returns "just now", "Nm", "Nh", or "Nd". Never throws on an unparseable date.
 */
export function timeAgo(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
