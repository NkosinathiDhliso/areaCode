type Tier = 'starter' | 'growth' | 'pro' | 'payg'

interface BillingStatusBannerProps {
  tier: Tier
  // Null or past means no active paid window.
  paidUntil: string | null
  // What the last successful payment bought (monthly, yearly, daily, weekly).
  paidInterval: string | null
  // 7-day renewal window after the paid window lapses.
  paymentGraceUntil: string | null
  // Non-null once a trial has been started (active or expired).
  trialEndsAt: string | null
  onRenew: () => void
  // True while any billing API call is in flight; disables the renew button.
  renewing: boolean
}

const TIER_LABELS: Record<Tier, string> = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
  payg: 'Pay-as-you-go',
}

// Readable date, e.g. "9 August 2026".
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function daysUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000))
}

function RenewButton({ onRenew, renewing }: { onRenew: () => void; renewing: boolean }) {
  return (
    <button
      onClick={onRenew}
      disabled={renewing}
      className="mt-2 self-start bg-[var(--accent)] text-white font-semibold rounded-xl px-4 py-2 text-sm transition-all duration-150 active:scale-95 disabled:opacity-50"
    >
      {renewing ? '...' : 'Renew plan'}
    </button>
  )
}

// Billing status header for the PlansPanel. Renders exactly one of:
// paid window active, grace window, trial countdown, or trial expired.
// A renew action shows when a renewal is possible (paid window active or grace).
export function BillingStatusBanner({
  tier,
  paidUntil,
  paidInterval,
  paymentGraceUntil,
  trialEndsAt,
  onRenew,
  renewing,
}: BillingStatusBannerProps) {
  const now = Date.now()
  const paidActive = paidUntil !== null && new Date(paidUntil).getTime() > now
  const graceActive = !paidActive && paymentGraceUntil !== null && new Date(paymentGraceUntil).getTime() > now
  const trialActive = !paidActive && !graceActive && trialEndsAt !== null && new Date(trialEndsAt).getTime() > now
  const trialExpired = !paidActive && !graceActive && !trialActive && trialEndsAt !== null

  const tierLabel = TIER_LABELS[tier]

  if (paidActive && paidUntil) {
    const interval = paidInterval ? ` (${paidInterval})` : ''
    return (
      <div className="bg-[var(--success-subtle,#e7f7ee)] border border-[var(--success)] rounded-2xl px-4 py-3 flex flex-col">
        <span className="text-[var(--text-primary)] text-sm font-medium">
          {tierLabel} · paid until {formatDate(paidUntil)}
          {interval}
        </span>
        <RenewButton onRenew={onRenew} renewing={renewing} />
      </div>
    )
  }

  if (graceActive && paymentGraceUntil) {
    return (
      <div className="bg-[var(--warning-subtle,#fdf1e7)] border border-[var(--warning)] rounded-2xl px-4 py-3 flex flex-col">
        <span className="text-[var(--text-primary)] text-sm font-medium">
          Payment overdue. Your {tierLabel} plan stays active until {formatDate(paymentGraceUntil)}. Renew now to keep
          your features.
        </span>
        <RenewButton onRenew={onRenew} renewing={renewing} />
      </div>
    )
  }

  if (trialActive && trialEndsAt) {
    const left = daysUntil(trialEndsAt, now)
    return (
      <div className="bg-[var(--success-subtle,#e7f7ee)] border border-[var(--success)] rounded-2xl px-4 py-3 text-[var(--text-primary)] text-sm">
        Free trial active. Your {tierLabel} features run until {formatDate(trialEndsAt)} ({left}{' '}
        {left === 1 ? 'day' : 'days'} left). Choose a plan before then to keep them.
      </div>
    )
  }

  if (trialExpired) {
    return (
      <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 text-[var(--text-secondary)] text-xs">
        Your trial has ended. Pick a plan to reactivate your paid features.
      </div>
    )
  }

  return null
}
