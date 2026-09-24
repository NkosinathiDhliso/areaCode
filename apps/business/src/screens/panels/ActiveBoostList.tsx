import { formatSastDate, formatSastTime, sastDateString } from '@area-code/shared/lib/sast'
import type { Node } from '@area-code/shared/types'

/**
 * Client-side Boost_Window read model (billing R5.6, mirrors backend
 * `nodes/boost.ts` `isBoostActive`). A node is boosted while its paid
 * `boostUntil` instant is still in the future. Computed purely at read time:
 * once the window passes this reads false on the next data refresh with no
 * residue (R5.5). Backend code is never imported into the frontend, so the
 * trivial `boostUntil > now` check lives here.
 */
function isBoostActive(boostUntil: string | null | undefined, nowMs: number): boolean {
  if (!boostUntil) return false
  const end = Date.parse(boostUntil)
  return Number.isFinite(end) && end > nowMs
}

/**
 * "18:00" when the window ends today, "9 Aug 2026 18:00" when it ends on a
 * later day, so an overnight boost reads honestly. Today is the venue's day, so
 * the comparison uses the shared SAST calendar date, not the device's.
 */
function formatBoostUntil(boostUntil: string, nowMs: number): string {
  const time = formatSastTime(boostUntil)
  if (sastDateString(boostUntil) === sastDateString(nowMs)) return time
  return `${formatSastDate(boostUntil)} ${time}`
}

interface ActiveBoostListProps {
  nodes: Node[]
}

/**
 * Shows "Boost active until <time>" for each owned node with a currently-active
 * Boost_Window (billing R5.6). Nodes without an active window render nothing;
 * once a window passes it disappears on the next data refresh (R5.5, honest,
 * no residue).
 */
export function ActiveBoostList({ nodes }: ActiveBoostListProps) {
  const now = Date.now()
  const active = nodes.filter((n) => isBoostActive(n.boostUntil, now))
  if (active.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {active.map((node) => (
        <div
          key={node.id}
          className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-row items-center justify-between gap-3"
        >
          <span className="text-[var(--text-primary)] text-sm font-medium">{node.name}</span>
          <span className="text-[var(--accent)] text-sm font-medium">
            Boost active until {formatBoostUntil(node.boostUntil as string, now)}
          </span>
        </div>
      ))}
    </div>
  )
}
