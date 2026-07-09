import { resolveEffectiveTier, resolveWindowSource } from '@area-code/shared/lib/businessLifecycle'
import type { BusinessTier } from '@area-code/shared/types'

interface BusinessStateBadgeProps {
  tier: BusinessTier | string
  trialEndsAt?: string | null
  paidUntil?: string | null
  paidInterval?: string | null
  paymentGraceUntil?: string | null
}

function formatDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const WINDOW_LABEL: Record<string, string> = {
  trial: 'Trial',
  paid: 'Paid',
  grace: 'Grace',
  none: 'No window',
}

// Read-only billing summary for admin BusinessManagement
// (cross-portal-lifecycle-alignment R2.1). Renders stored tier, effective tier
// (via the shared Tier_Resolver mirror), window source, Paid_Until, and grace.
// Display-only: the server remains the authority for feature gating.
export function BusinessStateBadge(props: BusinessStateBadgeProps) {
  const effectiveTier = resolveEffectiveTier(props)
  const windowSource = resolveWindowSource(props)
  const demoted = props.tier !== 'starter' && props.tier !== 'free' && effectiveTier === 'starter'

  return (
    <div className="mt-2 flex flex-row flex-wrap gap-2 text-xs">
      <span className="rounded-lg bg-[var(--bg-raised)] px-2 py-1 text-[var(--text-secondary)]">
        Stored: <span className="capitalize text-[var(--text-primary)]">{props.tier}</span>
      </span>
      <span
        className="rounded-lg bg-[var(--bg-raised)] px-2 py-1 text-[var(--text-secondary)]"
        style={demoted ? { color: 'var(--danger)' } : undefined}
      >
        Effective: <span className="capitalize">{effectiveTier}</span>
      </span>
      <span className="rounded-lg bg-[var(--bg-raised)] px-2 py-1 text-[var(--text-secondary)]">
        {WINDOW_LABEL[windowSource] ?? windowSource}
      </span>
      {props.paidUntil && (
        <span className="rounded-lg bg-[var(--bg-raised)] px-2 py-1 text-[var(--text-secondary)]">
          Paid until {formatDate(props.paidUntil)}
          {props.paidInterval ? ` (${props.paidInterval})` : ''}
        </span>
      )}
      {props.paymentGraceUntil && (
        <span className="rounded-lg bg-[var(--bg-raised)] px-2 py-1 text-[var(--text-secondary)]">
          Grace until {formatDate(props.paymentGraceUntil)}
        </span>
      )}
    </div>
  )
}
