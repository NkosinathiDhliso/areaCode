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

export function PlansPanel() {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [currentTier, setCurrentTier] = useState<'starter' | 'growth' | 'pro' | 'payg'>('starter')
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [plansRes, profileRes] = await Promise.all([
          api.get<PlansResponse>('/v1/business/plans'),
          api.get<{ tier?: string }>('/v1/business/me'),
        ])
        setPlans(plansRes)
        const raw = profileRes.tier ?? 'starter'
        // 'free' is a legacy value — treat it as starter for display
        const mapped = raw === 'free' ? 'starter' : raw
        setCurrentTier(mapped as 'starter' | 'growth' | 'pro' | 'payg')
      } catch {
        setLoadError(true)
      }
    }
    void load()
  }, [])

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

  function formatLimit(val: number | null): string {
    return val === null ? t('biz.plans.unlimited') : String(val)
  }

  function renderPlanCard(key: string, plan: PlanInfo, actionPlan?: 'growth' | 'pro' | 'payg') {
    const isStarter = !actionPlan
    const isPAYG = actionPlan === 'payg'
    const isCurrent = key === currentTier
    const priceDisplay = isPAYG
      ? `${formatZAR((plan.dailyPriceCents ?? 0) / 100)}/day`
      : plan.monthlyPriceCents === 0
        ? t('biz.plans.free')
        : `${formatZAR((plan.monthlyPriceCents ?? 0) / 100)}/mo`

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
          {plan.trialDays && !isCurrent && (
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

        <div className="flex flex-col gap-1 mt-1">
          <FeatureRow label={t('biz.plans.nodes')} value={formatLimit(plan.maxNodes)} />
          <FeatureRow label={t('biz.plans.rewards')} value={formatLimit(plan.maxRewards)} />
          <FeatureRow label={t('biz.plans.staff')} value={formatLimit(plan.maxStaff)} />
        </div>

        {actionPlan && !isCurrent && (
          <button
            onClick={() => handleSelectPlan(actionPlan, isPAYG ? 'daily' : 'monthly')}
            disabled={loading !== null}
            className={`font-semibold rounded-xl py-3 text-sm transition-all duration-150 active:scale-95 disabled:opacity-50 mt-1 ${
              key === 'growth'
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border-strong)] text-[var(--text-primary)] bg-transparent'
            }`}
          >
            {loading === actionPlan ? '...' : plan.trialDays ? t('biz.plans.startTrial') : t('biz.plans.subscribe')}
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
      {checkoutError && (
        <div className="bg-[var(--danger-subtle,#fee)] border border-[var(--danger)] rounded-xl px-4 py-3 text-[var(--danger)] text-sm">
          {checkoutError}
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
