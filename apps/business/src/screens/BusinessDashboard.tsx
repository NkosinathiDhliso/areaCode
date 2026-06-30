import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useBusinessStore, type DashboardPanel } from '@area-code/shared/stores/businessStore'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { Node } from '@area-code/shared/types'
import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

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
const StaffLeaderboardPanel = lazy(() =>
  import('./panels/StaffLeaderboardPanel').then((m) => ({ default: m.StaffLeaderboardPanel })),
)
const ReportsPanel = lazy(() => import('./panels/ReportsPanel').then((m) => ({ default: m.ReportsPanel })))
const MusicSchedulePanel = lazy(() => import('./MusicSchedulePanel').then((m) => ({ default: m.MusicSchedulePanel })))

const PANELS: DashboardPanel[] = [
  'live',
  'check-ins',
  'rewards',
  'reward-metrics',
  'audience',
  'boost',
  'music-schedule',
  'staff-leaderboard',
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
  'music-schedule': 'biz.panel.musicSchedule',
  'staff-leaderboard': 'biz.panel.staffLeaderboard',
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
  'music-schedule': 'view_settings',
  'staff-leaderboard': 'view_staff',
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
  const { currentPanel, setPanel, nodes, setNodes } = useBusinessStore()
  const navRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const primaryNode = nodes[0] ?? null
  const cdnUrl = import.meta.env['VITE_CDN_URL'] as string | undefined
  const headerImageUrl = primaryNode?.headerImageKey && cdnUrl ? `${cdnUrl}/${primaryNode.headerImageKey}` : null

  useEffect(() => {
    if (nodes.length > 0) return
    api
      .get<{ items: Node[] }>('/v1/business/me/nodes')
      .then((res) => setNodes(res.items ?? []))
      .catch(() => {
        // Surface the failure instead of swallowing it: every node-dependent
        // panel (rewards, boost, music schedule, settings) degrades without it.
        useErrorStore
          .getState()
          .showError(t('biz.dashboard.nodesError', "Couldn't load your venues. Some panels may be unavailable."))
      })
  }, [nodes.length, setNodes, t])

  // Filter panels based on the user's permissions. Fail closed: if permissions
  // could not be resolved (empty), show no panels and surface a retry state
  // rather than exposing every panel (including owner-only billing).
  const visiblePanels = PANELS.filter((panel) => hasPermission(PANEL_PERMISSIONS[panel]))
  const currentIdx = visiblePanels.indexOf(currentPanel)

  // If current panel is not visible (e.g. role changed), reset to first visible
  const activePanel = visiblePanels.includes(currentPanel) ? currentPanel : (visiblePanels[0] ?? 'live')

  // No panels visible means permissions could not be resolved. Show a retry
  // state instead of an empty shell or (worse) every panel.
  if (visiblePanels.length === 0) {
    return (
      <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
        <header
          className="flex flex-row items-center justify-between px-5 py-3 border-b border-[var(--border)]"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
        >
          <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">Area Code</span>
          <button onClick={logout} className="text-[var(--text-muted)] text-sm">
            {t('biz.logout')}
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <h2 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('biz.dashboard.permsTitle', "Couldn't load your dashboard")}
            </h2>
            <p className="text-[var(--text-secondary)] text-sm mb-5">
              {t(
                'biz.dashboard.permsBody',
                'We could not confirm your access permissions. Check your connection and try again.',
              )}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 text-sm"
            >
              {t('common.retry', 'Retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

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
      case 'staff-leaderboard':
        return <StaffLeaderboardPanel />
      case 'reports':
        return <ReportsPanel />
      case 'music-schedule':
        return <MusicSchedulePanel />
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
      <header
        className="flex flex-row items-center justify-between px-5 py-3 border-b border-[var(--border)]"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex flex-row items-center gap-2">
          {headerImageUrl && (
            <img
              src={headerImageUrl}
              alt={primaryNode?.name ?? 'Business'}
              className="w-9 h-9 rounded-xl object-cover border border-[var(--border)]"
            />
          )}
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

      {/* Scrollable tab nav (Issue #3 - replaces 10 dots with scrollable pills) */}
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

      {/* Single active panel (Issue #27 - only active panel mounts) */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <Suspense fallback={<PanelFallback />}>{renderPanel()}</Suspense>
      </div>
    </div>
  )
}
