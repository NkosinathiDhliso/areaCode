import type { BusinessTier } from '../types'

export type WindowSource = 'trial' | 'paid' | 'grace' | 'none'

interface LifecycleFields {
  tier?: BusinessTier | string
  trialEndsAt?: string | null
  paidUntil?: string | null
  paymentGraceUntil?: string | null
}

function windowActive(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false
  return new Date(iso).getTime() > nowMs
}

// Client-side mirror of the backend Tier_Resolver (`getEffectiveTier` in
// backend/src/features/business/service.ts, billing-revenue-integrity R4). This
// is DISPLAY-ONLY: the server stays the single authority for feature gating; the
// portals never gate on this. It lives in shared so the admin Business_State_Badge
// and any other portal read the same window algebra rather than each re-deriving
// it (cross-portal-lifecycle-alignment R2.1). A paid stored tier resolves only
// while at least one window (trial, paid, grace) is still open; otherwise starter.
export function resolveEffectiveTier(biz: LifecycleFields, nowMs: number = Date.now()): BusinessTier {
  const tier = biz.tier ?? 'free'
  if (tier === 'free' || tier === 'starter') return 'starter'
  if (
    windowActive(biz.trialEndsAt, nowMs) ||
    windowActive(biz.paidUntil, nowMs) ||
    windowActive(biz.paymentGraceUntil, nowMs)
  ) {
    return tier as BusinessTier
  }
  return 'starter'
}

// Which entitlement window currently keeps a paid tier alive, in resolver
// priority order (trial, then paid, then grace), or 'none' when the stored tier
// is free/starter or every window has lapsed.
export function resolveWindowSource(biz: LifecycleFields, nowMs: number = Date.now()): WindowSource {
  const tier = biz.tier ?? 'free'
  if (tier === 'free' || tier === 'starter') return 'none'
  if (windowActive(biz.trialEndsAt, nowMs)) return 'trial'
  if (windowActive(biz.paidUntil, nowMs)) return 'paid'
  if (windowActive(biz.paymentGraceUntil, nowMs)) return 'grace'
  return 'none'
}
