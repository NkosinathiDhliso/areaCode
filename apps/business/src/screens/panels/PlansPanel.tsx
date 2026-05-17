import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { formatZAR } from '@area-code/shared/lib/formatters'

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
  // Set (non-null) once a trial has ever been started — either active or expired.
  // The backend enforces one trial per business, so we use this to hide
  // the "Start trial" CTA for businesses that have already used theirs.
  trialEndsAt?: string | null
}

export function PlansPanel() {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [currentTier, setCurrentTier] = useState<'starter' | 'growth' | 'pro' | 'payg'>('starter')
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [plansRes, profileRes] = await Promise.all([
          api.get<PlansResponse>('/v1/business/plans'),
          api.get<BusinessProfile>('/v1/business/me'),
        ])
        setPlans(plansRes)
        const raw = profileRes.tier ?? 'starter'
        // 'free' is a legacy value — treat it as starter for display
        const mapped = raw === 'free' ? 'starter' : raw
        setCurrentTier(mapped as 'starter' | 'growth' | 'pro' | 'payg')
        setTrialEndsAt(profileRes.trialEndsAt ?? null)
      } catch {
        setLoadError(true)
      }
    }
    void load()
  }, [])

  // A business gets exactly one trial, ever. trialEndsAt being non-null means
  // they've already claimed it (active or expired), so new trial CTAs are hidden.
  const hasUsedTrial = trialEndsAt !== null
  const trialIsActive = trialEndsAt !== null && new Date(trialEndsAt).getTime() > Date.now()

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

    function handleClick() {
      if (!actionPlan) return
      if (canStartTrial && (actionPlan === 'growth' || actionPlan === 'pro')) {
        void handleStartTrial(actionPlan)
      } else {
        void handleSelectPlan(actionPlan, isPAYG ? 'daily' : 'monthly')
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
          <span className="text-[var(--text-muted)] text-xs">No card needed. Billing starts after your trial.</span>
        )}

        <div className="flex flex-col gap-1 mt-1">
          <FeatureRow label={t('biz.plans.nodes')} value={formatLimit(plan.maxNodes)} />
          <FeatureRow label={t('biz.plans.rewards')} value={formatLimit(plan.maxRewards)} />
          <FeatureRow label={t('biz.plans.staff')} value={formatLimit(plan.maxStaff)} />
        </div>

        {actionPlan && !isCurrent && (
          <button
            onClick={handleClick}
            disabled={loading !== null}
            className={`font-semibold rounded-xl py-3 text-sm transition-all duration-150 active:scale-95 disabled:opacity-50 mt-1 ${
              key === 'growth'
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border-strong)] text-[var(--text-primary)] bg-transparent'
            }`}
          >
            {loading === actionPlan ? '...' : canStartTrial ? t('biz.plans.startTrial') : t('biz.plans.subscribe')}
          </button>
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

      {trialIsActive && trialEndsAt && (
        <div className="bg-[var(--success-subtle,#e7f7ee)] border border-[var(--success)] rounded-xl px-4 py-3 text-[var(--text-primary)] text-sm">
          Free trial active — ends {new Date(trialEndsAt).toLocaleDateString()}. Add a payment method before then to
          keep your {currentTier} features.
        </div>
      )}
      {!trialIsActive && hasUsedTrial && (
        <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text-secondary)] text-xs">
          Your trial is over — pick a plan.
        </div>
      )}
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

      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('biz.plans.cancelTitle', 'Cancel subscription?')}
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              {t(
                'biz.plans.cancelBody',
                'Your plan will be downgraded to Starter immediately. You will lose access to paid features like extra nodes, rewards, and staff slots.',
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
