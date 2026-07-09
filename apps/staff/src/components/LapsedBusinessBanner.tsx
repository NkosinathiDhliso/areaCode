import { AlertCircle } from 'lucide-react'

// Staff-portal honest lapsed-business state (cross-portal-lifecycle-alignment
// R3.1). Shown when the staff member's business is inactive or resolved to
// starter after a non-payment demotion. Names the state and what still works
// (validating already-earned codes). No billing amounts, no blame — the banner
// never blocks the validator, because earned codes still redeem (R3.2).
export function LapsedBusinessBanner() {
  return (
    <div
      role="status"
      className="mx-4 mt-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 flex flex-row gap-3"
    >
      <AlertCircle size={20} strokeWidth={1.75} className="text-[var(--accent)] shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1">
        <span className="text-[var(--text-primary)] font-semibold text-sm">This account is no longer active</span>
        <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
          The venue has left Area Code, so it no longer appears on the map and new rewards cannot be earned here. You
          can still validate codes customers already earned. Contact the owner to reactivate the account.
        </p>
      </div>
    </div>
  )
}
