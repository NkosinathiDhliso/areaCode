import { useRef, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useBusinessStore, type DashboardPanel } from '@area-code/shared/stores/businessStore'
import { Spinner } from '@area-code/shared/components/Spinner'

// Lazy-load panels so only the active one mounts (Issue #27)
const LivePanel = lazy(() => import('./panels/LivePanel').then((m) => ({ default: m.LivePanel })))
const RewardsPanel = lazy(() => import('./panels/RewardsPanel').then((m) => ({ default: m.RewardsPanel })))
const AudiencePanel = lazy(() => import('./panels/AudiencePanel').then((m) => ({ default: m.AudiencePanel })))
const NodeEditorPanel = lazy(() => import('./panels/NodeEditorPanel').then((m) => ({ default: m.NodeEditorPanel })))
const BoostPanel = lazy(() => import('./panels/BoostPanel').then((m) => ({ default: m.BoostPanel })))
const PlansPanel = lazy(() => import('./panels/PlansPanel').then((m) => ({ default: m.PlansPanel })))
const SettingsPanel = lazy(() => import('./panels/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const CheckInDetailPanel = lazy(() => import('./panels/CheckInDetailPanel').then((m) => ({ default: m.CheckInDetailPanel })))
const RewardMetricsPanel = lazy(() => import('./panels/RewardMetricsPanel').then((m) => ({ default: m.RewardMetricsPanel })))
const StaffRedemptionPanel = lazy(() => import('./panels/StaffRedemptionPanel').then((m) => ({ default: m.StaffRedemptionPanel })))

const PANELS: DashboardPanel[] = ['live', 'check-ins', 'rewards', 'reward-metrics', 'audience', 'node', 'boost', 'staff-redemptions', 'plans', 'settings']

const PANEL_LABELS: Record<DashboardPanel, string> = {
  live: 'biz.panel.live',
  'check-ins': 'biz.panel.checkIns',
  rewards: 'biz.panel.rewards',
  'reward-metrics': 'biz.panel.rewardMetrics',
  audience: 'biz.panel.audience',
  node: 'biz.panel.node',
  boost: 'biz.panel.boost',
  'staff-redemptions': 'biz.panel.staffRedemptions',
  plans: 'biz.panel.plans',
  settings: 'biz.panel.settings',
}

function PanelFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <Spinner size="lg" />
    </div>
  )
}

export function BusinessDashboard() {
  const { t } = useTranslation()
  const logout = useBusinessAuthStore((s) => s.logout)
  const { currentPanel, setPanel } = useBusinessStore()
  const navRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const currentIdx = PANELS.indexOf(currentPanel)

  function handleTouchStart(e: React.TouchEvent) {
    setTouchStart(e.touches[0]?.clientX ?? null)
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStart === null) return
    const diff = (e.changedTouches[0]?.clientX ?? 0) - touchStart
    if (Math.abs(diff) > 60) {
      if (diff < 0 && currentIdx < PANELS.length - 1) {
        setPanel(PANELS[currentIdx + 1]!)
      } else if (diff > 0 && currentIdx > 0) {
        setPanel(PANELS[currentIdx - 1]!)
      }
    }
    setTouchStart(null)
  }

  function renderPanel() {
    switch (currentPanel) {
      case 'live': return <LivePanel />
      case 'check-ins': return <CheckInDetailPanel />
      case 'rewards': return <RewardsPanel />
      case 'reward-metrics': return <RewardMetricsPanel />
      case 'audience': return <AudiencePanel />
      case 'node': return <NodeEditorPanel />
      case 'boost': return <BoostPanel />
      case 'staff-redemptions': return <StaffRedemptionPanel />
      case 'plans': return <PlansPanel />
      case 'settings': return <SettingsPanel />
      default: return <LivePanel />
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)] overflow-hidden">
      {/* Header */}
      <header className="flex flex-row items-center justify-between px-5 py-3 border-b border-[var(--border)]">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          Area Code
        </span>
        <button onClick={logout} className="text-[var(--text-muted)] text-sm">
          {t('biz.logout')}
        </button>
      </header>

      {/* Scrollable tab nav (Issue #3 — replaces 10 dots with scrollable pills) */}
      <nav
        ref={navRef}
        className="flex flex-row items-center gap-1 px-4 py-2.5 border-b border-[var(--border)] overflow-x-auto no-scrollbar"
      >
        {PANELS.map((panel) => (
          <button
            key={panel}
            onClick={() => setPanel(panel)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 whitespace-nowrap ${
              panel === currentPanel
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            aria-label={t(PANEL_LABELS[panel])}
          >
            {t(PANEL_LABELS[panel])}
          </button>
        ))}
      </nav>

      {/* Single active panel (Issue #27 — only active panel mounts) */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <Suspense fallback={<PanelFallback />}>
          {renderPanel()}
        </Suspense>
      </div>
    </div>
  )
}
