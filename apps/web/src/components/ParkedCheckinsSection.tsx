import { useErrorStore } from '@area-code/shared/stores/errorStore'

import { isParked } from '../lib/checkinOutbox'
import { useCheckinOutboxStore } from '../stores/checkinOutboxStore'

function formatCaptured(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Parked check-in failures (cross-portal-lifecycle-alignment R5.6). A check-in
 * that failed on flaky data and exhausted its automatic retries lands here, where
 * the user can retry it (subject to the 15-minute Replay_Window) or discard it.
 * Honest: a retry that has aged out is discarded with a clear message rather than
 * silently doing nothing.
 */
export function ParkedCheckinsSection() {
  const entries = useCheckinOutboxStore((s) => s.entries)
  const retryParked = useCheckinOutboxStore((s) => s.retryParked)
  const discard = useCheckinOutboxStore((s) => s.discard)
  const showError = useErrorStore((s) => s.showError)

  const parked = entries.filter(isParked)
  if (parked.length === 0) return null

  const onRetry = (id: string) => {
    const outcome = retryParked(id)
    if (outcome === 'discarded') {
      showError('That check-in was too old to record and has been discarded.')
    }
  }

  return (
    <div className="mb-6" data-testid="parked-checkins">
      <h2 className="text-[var(--text-primary)] font-bold text-lg font-[Syne] mb-1">Check-ins that need attention</h2>
      <p className="text-[var(--text-muted)] text-xs mb-3">
        These check-ins could not be sent after a few tries. Retry them or clear them out.
      </p>
      <div className="flex flex-col gap-3">
        {parked.map((entry) => (
          <div
            key={entry.id}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-row items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-[var(--text-primary)] text-sm font-medium">Check-in not sent</p>
              <p className="text-[var(--text-muted)] text-xs mt-0.5">Tried at {formatCaptured(entry.capturedAt)}</p>
            </div>
            <div className="flex flex-row gap-2 flex-shrink-0">
              <button
                onClick={() => onRetry(entry.id)}
                className="border border-[var(--accent)] text-[var(--accent)] rounded-xl px-3 py-1.5 text-xs font-medium active:scale-95"
              >
                Retry
              </button>
              <button
                onClick={() => discard(entry.id)}
                className="border border-[var(--border)] text-[var(--text-secondary)] rounded-xl px-3 py-1.5 text-xs active:scale-95"
              >
                Discard
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
