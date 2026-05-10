import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { formatZAR } from '@area-code/shared/lib/formatters'
import { Badge } from '@area-code/shared/components/Badge'
import { MetricCard } from '@area-code/shared/components/MetricCard'
import { Card } from '@area-code/shared/components/Card'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { NodeState } from '@area-code/shared/types'

interface OverviewData {
  pulseState: NodeState
  currentPlan: string
  nextBillingDate: string | null
  boostEndsAt: string | null
  todayCheckIns: number
  todayRedemptions: number
  setupCompletion: number
}

interface SetupItem {
  key: string
  label: string
  done: boolean
  panel: string
}

export function OverviewPanel() {
  const { t } = useTranslation()
  const { setPanel, nodes } = useBusinessStore()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get<OverviewData>('/v1/business/me/overview')
        setData(res)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const setupItems: SetupItem[] = [
    { key: 'node', label: t('business.setup.createVenue', 'Create your venue'), done: nodes.length > 0, panel: 'settings' },
    { key: 'image', label: t('business.setup.addPhoto', 'Add a header photo'), done: false, panel: 'settings' },
    { key: 'reward', label: t('business.setup.createReward', 'Create your first reward'), done: false, panel: 'rewards' },
    { key: 'staff', label: t('business.setup.inviteStaff', 'Invite staff'), done: false, panel: 'staff-redemptions' },
    { key: 'plan', label: t('business.setup.choosePlan', 'Choose a plan'), done: data?.currentPlan !== 'starter', panel: 'plans' },
  ]

  const completedCount = setupItems.filter((i) => i.done).length
  const setupPercent = Math.round((completedCount / setupItems.length) * 100)
  const nextAction = setupItems.find((i) => !i.done)

  if (loading) {
    return (
      <div className="p-5 flex flex-col gap-4">
        <div className="h-6 w-40 bg-[var(--bg-raised)] rounded animate-shimmer" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-[var(--bg-raised)] rounded-2xl p-4 h-20 animate-shimmer" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-5 flex items-center justify-center py-16">
        <span className="text-[var(--danger)] text-sm">{t('business.overview.loadError', 'Failed to load overview.')}</span>
      </div>
    )
  }

  const boostActive = data.boostEndsAt && new Date(data.boostEndsAt).getTime() > Date.now()
  const boostRemaining = boostActive
    ? formatCountdown(new Date(data.boostEndsAt!).getTime() - Date.now())
    : null

  return (
    <div className="p-5 flex flex-col gap-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('business.overview.title', 'Overview')}</h2>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard value={data.pulseState} label={t('business.overview.pulseState', 'Pulse State')} loading={false} />
        <MetricCard value={`${data.todayCheckIns}`} label={t('business.overview.checkInsToday', 'Check-ins Today')} loading={false} />
        <MetricCard value={`${data.todayRedemptions}`} label={t('business.overview.redemptionsToday', 'Redemptions Today')} loading={false} />
        <MetricCard value={`${setupPercent}%`} label={t('business.overview.setupComplete', 'Setup Complete')} loading={false} />
      </div>

      {/* Plan + Billing */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[var(--text-primary)] text-sm font-medium capitalize">{data.currentPlan} {t('business.overview.plan', 'Plan')}</p>
            {data.nextBillingDate && (
              <p className="text-[var(--text-muted)] text-xs mt-0.5">
                {t('business.overview.nextBilling', 'Next billing:')} {new Date(data.nextBillingDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
              </p>
            )}
          </div>
          <button onClick={() => setPanel('plans')} className="text-[var(--accent)] text-xs font-medium">
            {t('business.overview.manage', 'Manage')}
          </button>
        </div>
      </Card>

      {/* Active Boost */}
      {boostActive && (
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-boost-gold)]">⚡</span>
              <span className="text-[var(--text-primary)] text-sm font-medium">{t('business.overview.boostActive', 'Boost Active')}</span>
            </div>
            <span className="text-[var(--color-boost-gold)] text-sm font-bold">{boostRemaining}</span>
          </div>
        </Card>
      )}

      {/* Setup Checklist */}
      {setupPercent < 100 && (
        <div>
          <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
            {t('business.overview.setupChecklist', 'Setup Checklist')}
          </h3>
          <div className="flex flex-col gap-2">
            {setupItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setPanel(item.panel as Parameters<typeof setPanel>[0])}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                  item.done
                    ? 'border-[var(--success)]/30 bg-[var(--success-soft)]'
                    : item === nextAction
                      ? 'border-[var(--accent)] bg-[var(--bg-surface)]'
                      : 'border-[var(--border)] bg-[var(--bg-surface)]'
                }`}
              >
                <span className={`text-sm ${item.done ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
                  {item.done ? '✓' : '○'}
                </span>
                <span className={`text-sm ${item.done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'}`}>
                  {item.label}
                </span>
                {item === nextAction && !item.done && (
                  <Badge variant="status" label={t('common.next', 'Next')} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatCountdown(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
