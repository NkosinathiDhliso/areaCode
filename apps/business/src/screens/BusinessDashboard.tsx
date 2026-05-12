import { useRef, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useBusinessStore, type DashboardPanel } from '@area-code/shared/stores/businessStore'
import { Spinner } from '@area-code/shared/components/Spinner'

// Lazy-load panels so only the active one mounts (Issue #27)
const LivePanel = lazy(() => import('./panels/LivePanel').then((m) => ({ default: m.LivePanel })))
const RewardsPanel = lazy(() => import('./panels/RewardsPanel').then((m) => ({ default: m.RewardsPanel })))
const AudiencePanel = lazy(() => import('./panels/AudiencePanel').then((m) => ({ default: m.AudiencePanel })))
const BoostPanel = lazy(() => import('./panels/BoostPanel').then((m) => ({ default: m.BoostPanel })))
const PlansPanel = lazy(() => import('./panels/PlansPanel').then((m) => ({ default: m.PlansPanel })))
const SettingsPanel = lazy(() => import('./panels/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const CheckInDetailPanel = lazy(() =>
  import('./panels/CheckInDetailPanel').then((m) => ({ default: m.CheckInDetailPanel })),
)
const RewardMetricsPanel = lazy(() =>
  import('./panels/RewardMetricsPanel').then((m) => ({ default: m.RewardMetricsPanel })),
)
const StaffRedemptionPanel = lazy(() =>
  import('./panels/StaffRedemptionPanel').then((m) => ({ default: m.StaffRedemptionPanel })),
)
const ReportsPanel = lazy(() => import('./panels/ReportsPanel').then((m) => ({ default: m.ReportsPanel })))

const PANELS: DashboardPanel[] = [
  'live',
  'check-ins',
  'rewards',
  'reward-metrics',
  'audience',
  'boost',
  'staff-redemptions',
  'reports',
  'plans',
  'settings',
]

const PANEL_LABELS: Record<DashboardPanel, string> = {
  live: 'biz.panel.live',
  'check-ins': 'biz.panel.checkIns',
  rewards: 'biz.panel.rewards',
  'reward-metrics': 'biz.panel.rewardMetrics',
  audience: 'biz.panel.audience',
  boost: 'biz.panel.boost',
  'staff-redemptions': 'biz.panel.staffRedemptions',
  reports: 'biz.panel.reports',
  plans: 'biz.panel.plans',
  settings: 'biz.panel.settings',
}

// Permission required to see each panel. If the user lacks the permission,
// the panel is hidden from the nav entirely (no confusing disabled states).
const PANEL_PERMISSIONS: Record<DashboardPanel, string> = {
  live: 'view_live',
  'check-ins': 'view_check_ins',
  rewards: 'view_rewards',
  'reward-metrics': 'view_metrics',
  audience: 'view_audience',
  boost: 'manage_boost',
  'staff-redemptions': 'view_staff',
  reports: 'view_reports',
  plans: 'view_plans',
  settings: 'view_settings',
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
  const hasPermission = useBusinessAuthStore((s) => s.hasPermission)
  const role = useBusinessAuthStore((s) => s.role)
  const { currentPanel, setPanel } = useBusinessStore()
  const navRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [touchStart, setTouchStart] = useState<number | null>(null)

  // Filter panels based on user's permissions
  const visiblePanels = PANELS.filter((panel) => hasPermission(PANEL_PERMISSIONS[panel]))
  const currentIdx = visiblePanels.indexOf(currentPanel)

  // If current panel is not visible (e.g. role changed), reset to first visible
  const activePanel = visiblePanels.includes(currentPanel) ? currentPanel : (visiblePanels[0] ?? 'live')

  function handleTouchStart(e: React.TouchEvent) {
    setTouchStart(e.touches[0]?.clientX ?? null)
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStart === null) return
    const diff = (e.changedTouches[0]?.clientX ?? 0) - touchStart
    if (Math.abs(diff) > 60) {
      if (diff < 0 && currentIdx < visiblePanels.length - 1) {
        setPanel(visiblePanels[currentIdx + 1]!)
      } else if (diff > 0 && currentIdx > 0) {
        setPanel(visiblePanels[currentIdx - 1]!)
      }
    }
    setTouchStart(null)
  }

  function renderPanel() {
    switch (activePanel) {
      case 'live':
        return <LivePanel />
      case 'check-ins':
        return <CheckInDetailPanel />
      case 'rewards':
        return <RewardsPanel />
      case 'reward-metrics':
        return <RewardMetricsPanel />
      case 'audience':
        return <AudiencePanel />
      case 'boost':
        return <BoostPanel />
      case 'staff-redemptions':
        return <StaffRedemptionPanel />
      case 'reports':
        return <ReportsPanel />
      case 'plans':
        return <PlansPanel />
      case 'settings':
        return <SettingsPanel />
      default:
        return <LivePanel />
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)] overflow-hidden">
      {/* Header */}
      <header className="flex flex-row items-center justify-between px-5 py-3 border-b border-[var(--border)]">
        <div className="flex flex-row items-center gap-2">
          <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">Area Code</span>
          {role && role !== 'owner' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium capitalize">
              {role}
            </span>
          )}
        </div>
        <button onClick={logout} className="text-[var(--text-muted)] text-sm">
          {t('biz.logout')}
        </button>
      </header>

      {/* Scrollable tab nav (Issue #3 — replaces 10 dots with scrollable pills) */}
      <nav
        ref={navRef}
        className="flex flex-row items-center gap-1 px-4 py-2.5 border-b border-[var(--border)] overflow-x-auto no-scrollbar"
      >
        {visiblePanels.map((panel) => (
          <button
            key={panel}
            onClick={() => setPanel(panel)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 whitespace-nowrap ${
              panel === activePanel
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
        <Suspense fallback={<PanelFallback />}>{renderPanel()}</Suspense>
      </div>
    </div>
  )
}
