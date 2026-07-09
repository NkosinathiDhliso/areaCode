import { api } from '@area-code/shared/lib/api'
import { formatZAR } from '@area-code/shared/lib/formatters'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SubscriptionHistoryPanel } from '../../components/SubscriptionHistoryPanel'

import { BillingStatusBanner } from './BillingStatusBanner'
import { CheckoutReturnBanner } from './CheckoutReturnBanner'
import { useCheckoutReturn } from './useCheckoutReturn'

interface PlanInfo {
  name: string
  monthlyPriceCents?: number
  yearlyPriceCents?: number
  dailyPriceCents?: number
  weeklyPriceCents?: number
  maxNodes: number | null
  maxRewards: number | null
  maxStaff: number | null
  trialDays?: number
}

interface PlansResponse {
  starter: PlanInfo
  growth: PlanInfo
  pro: PlanInfo
  payg: PlanInfo
}

interface BusinessProfile {
  tier?: string
  // Set (non-null) once a trial has ever been started - either active or expired.
  // The backend enforces one trial per business, so we use this to hide
  // the "Start trial" CTA for businesses that have already used theirs.
  trialEndsAt?: string | null
  // Billing lifecycle fields (billing-revenue-integrity R2.6). Present on
  // GET /v1/business/me: end of the current paid window, what was bought, and
  // the 7-day grace window after a paid window lapses.
  paidUntil?: string | null
  paidInterval?: string | null
  paymentGraceUntil?: string | null
}

export function PlansPanel() {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [currentTier, setCurrentTier] = useState<'starter' | 'growth' | 'pro' | 'payg'>('starter')
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [paidUntil, setPaidUntil] = useState<string | null>(null)
  const [paidInterval, setPaidInterval] = useState<string | null>(null)
  const [paymentGraceUntil, setPaymentGraceUntil] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Applies a freshly loaded profile to local billing state. Shared by the
  // initial load and the checkout-return poll so the banner updates in place.
  const applyProfile = useCallback((profileRes: BusinessProfile) => {
    const raw = profileRes.tier ?? 'starter'
    // 'free' is a legacy value - treat it as starter for display
    const mapped = raw === 'free' ? 'starter' : raw
    setCurrentTier(mapped as 'starter' | 'growth' | 'pro' | 'payg')
    setTrialEndsAt(profileRes.trialEndsAt ?? null)
    setPaidUntil(profileRes.paidUntil ?? null)
    setPaidInterval(profileRes.paidInterval ?? null)
    setPaymentGraceUntil(profileRes.paymentGraceUntil ?? null)
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const [plansRes, profileRes] = await Promise.all([
          api.get<PlansResponse>('/v1/business/plans'),
          api.get<BusinessProfile>('/v1/business/me'),
        ])
        setPlans(plansRes)
        applyProfile(profileRes)
      } catch {
        setLoadError(true)
      }
    }
    void load()
  }, [applyProfile])

  // Checkout return flow (R6): reads ?status on mount, polls to confirm a
  // success, and strips the param so a refresh does not replay it.
  const { returnState, isPolling, dismiss } = useCheckoutReturn<BusinessProfile>({ onProfile: applyProfile })

  // A business gets exactly one trial, ever. trialEndsAt being non-null means
  // they've already claimed it (active or expired), so new trial CTAs are hidden.
  const hasUsedTrial = trialEndsAt !== null

  async function handleStartTrial(plan: 'growth' | 'pro') {
    setLoading(plan)
    setCheckoutError(null)
    try {
      const res = await api.post<{ success: boolean; tier: string; trialEndsAt: string }>('/v1/business/trial/start', {
        plan,
      })
      // Update local state so the UI reflects the active trial immediately
      setCurrentTier(res.tier as 'starter' | 'growth' | 'pro' | 'payg')
      setTrialEndsAt(res.trialEndsAt)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message
      setCheckoutError(msg && msg.length < 200 ? msg : 'Failed to start trial. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function handleSelectPlan(plan: 'growth' | 'pro' | 'payg', interval?: string) {
    setLoading(plan)
    setCheckoutError(null)
    try {
      const res = await api.post<{ checkoutUrl: string }>('/v1/business/checkout', { plan, interval })
      if (res.checkoutUrl && !res.checkoutUrl.startsWith('#')) {
        window.location.href = res.checkoutUrl
      } else {
        setCheckoutError('Payment provider did not return a checkout URL. Please try again.')
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message
      setCheckoutError(msg && msg.length < 200 ? msg : 'Failed to start checkout. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  // R7.6: a renewal is a normal checkout for the plan and interval the business
  // already holds. Reuses the createCheckoutSession path; on success the backend
  // extends Paid_Until from max(now, current Paid_Until).
  function handleRenew() {
    if (currentTier === 'starter') return
    const interval = paidInterval ?? (currentTier === 'payg' ? 'daily' : 'monthly')
    void handleSelectPlan(currentTier, interval)
  }

  async function handleCancelSubscription() {
    setCancelling(true)
    setCheckoutError(null)
    try {
      const res = await api.post<{ success: boolean; tier: string }>('/v1/business/downgrade', {})
      setCurrentTier(res.tier as 'starter' | 'growth' | 'pro' | 'payg')
      setShowCancelConfirm(false)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message
      setCheckoutError(msg && msg.length < 200 ? msg : 'Failed to cancel subscription. Please try again.')
      setShowCancelConfirm(false)
    } finally {
      setCancelling(false)
    }
  }

  function formatLimit(val: number | null): string {
    return val === null ? t('biz.plans.unlimited') : String(val)
  }

  function renderPlanCard(key: string, plan: PlanInfo, actionPlan?: 'growth' | 'pro' | 'payg') {
    const isPAYG = actionPlan === 'payg'
    const isCurrent = key === currentTier
    // Offer a free trial only when the plan supports it AND the business
    // hasn't already claimed their one trial.
    const canStartTrial = !!plan.trialDays && !hasUsedTrial && (actionPlan === 'growth' || actionPlan === 'pro')
    const priceDisplay = isPAYG
      ? `${formatZAR((plan.dailyPriceCents ?? 0) / 100)}/day`
      : plan.monthlyPriceCents === 0
        ? t('biz.plans.free')
        : `${formatZAR((plan.monthlyPriceCents ?? 0) / 100)}/mo`

    // Growth/Pro only. PAYG has its own day/week purchase buttons below.
    function handleClick() {
      if (!actionPlan || isPAYG) return
      if (canStartTrial) {
        void handleStartTrial(actionPlan as 'growth' | 'pro')
      } else {
        void handleSelectPlan(actionPlan, 'monthly')
      }
    }

    return (
      <div
        key={key}
        className={`bg-[var(--bg-surface)] border rounded-2xl p-5 flex flex-col gap-3 ${
          isCurrent
            ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
            : key === 'growth'
              ? 'border-[var(--accent)]'
              : 'border-[var(--border)]'
        }`}
      >
        <div className="flex flex-row items-center justify-between">
          <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">{plan.name}</span>
          {isCurrent && <span className="text-[var(--accent)] text-xs font-medium">{t('biz.plans.current')}</span>}
          {canStartTrial && !isCurrent && (
            <span className="text-[var(--success)] text-xs font-medium">{plan.trialDays}-day free trial</span>
          )}
        </div>

        <span className="text-[var(--accent)] font-bold text-2xl tracking-[-0.03em]">{priceDisplay}</span>
        {!isPAYG && plan.yearlyPriceCents !== undefined && plan.yearlyPriceCents > 0 && (
          <span className="text-[var(--text-muted)] text-xs">
            or {formatZAR(plan.yearlyPriceCents / 100)}/year (save ~17%)
          </span>
        )}
        {isPAYG && plan.weeklyPriceCents !== undefined && (
          <span className="text-[var(--text-muted)] text-xs">or {formatZAR(plan.weeklyPriceCents / 100)}/week</span>
        )}
        {canStartTrial && (
          <span className="text-[var(--text-muted)] text-xs">
            {t(
              'biz.plans.trialNoCard',
              'No card needed to start. Choose a plan before your trial ends to keep your features.',
            )}
          </span>
        )}

        <div className="flex flex-col gap-1 mt-1">
          <FeatureRow label={t('biz.plans.nodes')} value={formatLimit(plan.maxNodes)} />
          <FeatureRow label={t('biz.plans.rewards')} value={formatLimit(plan.maxRewards)} />
          <FeatureRow label={t('biz.plans.staff')} value={formatLimit(plan.maxStaff)} />
        </div>

        {actionPlan && !isCurrent && !isPAYG && (
          <button
            onClick={handleClick}
            disabled={loading !== null || isPolling}
            className={`font-semibold rounded-xl py-3 text-sm transition-all duration-150 active:scale-95 disabled:opacity-50 mt-1 ${
              key === 'growth'
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border-strong)] text-[var(--text-primary)] bg-transparent'
            }`}
          >
            {loading === actionPlan ? '...' : canStartTrial ? t('biz.plans.startTrial') : t('biz.plans.subscribe')}
          </button>
        )}
        {isPAYG && !isCurrent && (
          <div className="flex flex-col gap-2 mt-1">
            <button
              onClick={() => void handleSelectPlan('payg', 'daily')}
              disabled={loading !== null || isPolling}
              className="font-semibold rounded-xl py-3 text-sm transition-all duration-150 active:scale-95 disabled:opacity-50 border border-[var(--border-strong)] text-[var(--text-primary)] bg-transparent"
            >
              {loading === 'payg'
                ? '...'
                : t('biz.plans.buyDayPass', 'Buy day pass ({{price}})', {
                    price: `${formatZAR((plan.dailyPriceCents ?? 0) / 100)}/day`,
                  })}
            </button>
            {plan.weeklyPriceCents !== undefined && (
              <button
                onClick={() => void handleSelectPlan('payg', 'weekly')}
                disabled={loading !== null || isPolling}
                className="font-semibold rounded-xl py-3 text-sm transition-all duration-150 active:scale-95 disabled:opacity-50 border border-[var(--border-strong)] text-[var(--text-primary)] bg-transparent"
              >
                {loading === 'payg'
                  ? '...'
                  : t('biz.plans.buyWeekPass', 'Buy week pass ({{price}})', {
                      price: `${formatZAR((plan.weeklyPriceCents ?? 0) / 100)}/week`,
                    })}
              </button>
            )}
          </div>
        )}
        {isCurrent && (
          <span className="text-[var(--accent)] text-xs text-center font-medium">{t('biz.plans.currentPlan')}</span>
        )}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-5 flex items-center justify-center py-16">
        <span className="text-[var(--danger)] text-sm">Failed to load plans. Check your connection and refresh.</span>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.plans.title')}</h2>
      <p className="text-[var(--text-secondary)] text-sm">{t('biz.plans.subtitle')}</p>

      <CheckoutReturnBanner state={returnState} onDismiss={dismiss} />

      <BillingStatusBanner
        tier={currentTier}
        paidUntil={paidUntil}
        paidInterval={paidInterval}
        paymentGraceUntil={paymentGraceUntil}
        trialEndsAt={trialEndsAt}
        onRenew={handleRenew}
        renewing={loading !== null || isPolling}
      />
      {checkoutError && (
        <div className="bg-[var(--danger-subtle,#fee)] border border-[var(--danger)] rounded-xl px-4 py-3 text-[var(--danger)] text-sm">
          {checkoutError}
        </div>
      )}

      {!plans && !loadError && (
        <div className="flex flex-col gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-3"
            >
              <div className="h-5 w-24 bg-[var(--bg-raised)] rounded-lg animate-pulse" />
              <div className="h-8 w-32 bg-[var(--bg-raised)] rounded-lg animate-pulse" />
              <div className="h-3 w-48 bg-[var(--bg-raised)] rounded-lg animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {plans && (
        <div className="flex flex-col gap-4">
          {renderPlanCard('starter', plans.starter)}
          {renderPlanCard('growth', plans.growth, 'growth')}
          {renderPlanCard('pro', plans.pro, 'pro')}
          {renderPlanCard('payg', plans.payg, 'payg')}
        </div>
      )}

      {currentTier !== 'starter' && (
        <button onClick={() => setShowCancelConfirm(true)} className="w-full text-[var(--danger)] text-sm mt-4">
          {t('biz.plans.cancelSubscription', 'Cancel subscription')}
        </button>
      )}

      {/* Past subscription payments (R7.5). Self-handles its own empty state. */}
      <SubscriptionHistoryPanel />

      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('biz.plans.cancelTitle', 'Cancel subscription?')}
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              {t(
                'biz.plans.cancelBody',
                'Your plan will be downgraded to Starter immediately, and your venues will be removed from the consumer map. You will lose access to paid features like extra nodes, gets, and staff slots.',
              )}
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                {t('common.cancel', 'Keep plan')}
              </button>
              <button
                onClick={() => void handleCancelSubscription()}
                disabled={cancelling}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium"
              >
                {cancelling ? '...' : t('biz.plans.confirmCancel', 'Cancel subscription')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FeatureRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-row items-center justify-between">
      <span className="text-[var(--text-secondary)] text-xs">{label}</span>
      <span className="text-[var(--text-primary)] text-xs font-medium">{value}</span>
    </div>
  )
}
