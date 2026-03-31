import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useBusinessStore, type DashboardPanel } from '@area-code/shared/stores/businessStore'
import { LivePanel } from './panels/LivePanel'
import { RewardsPanel } from './panels/RewardsPanel'
import { AudiencePanel } from './panels/AudiencePanel'
import { NodeEditorPanel } from './panels/NodeEditorPanel'
import { BoostPanel } from './panels/BoostPanel'
import { SettingsPanel } from './panels/SettingsPanel'

const PANELS: DashboardPanel[] = ['live', 'rewards', 'audience', 'node', 'boost', 'settings']

const PANEL_LABELS: Record<DashboardPanel, string> = {
  live: 'biz.panel.live',
  rewards: 'biz.panel.rewards',
  audience: 'biz.panel.audience',
  node: 'biz.panel.node',
  boost: 'biz.panel.boost',
  settings: 'biz.panel.settings',
}

export function BusinessDashboard() {
  const { t } = useTranslation()
  const logout = useBusinessAuthStore((s) => s.logout)
  const { currentPanel, setPanel } = useBusinessStore()
  const currentIdx = PANELS.indexOf(currentPanel)
  const containerRef = useRef<HTMLDivElement>(null)
  const [touchStart, setTouchStart] = useState<number | null>(null)

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

      {/* Panel indicator dots */}
      <nav className="flex flex-row items-center justify-center gap-3 py-3">
        {PANELS.map((panel, idx) => (
          <button
            key={panel}
            onClick={() => setPanel(panel)}
            className="flex flex-col items-center gap-1"
            aria-label={t(PANEL_LABELS[panel])}
          >
            <div
              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                idx === currentIdx
                  ? 'bg-[var(--accent)] scale-125'
                  : 'bg-[var(--text-muted)] scale-100'
              }`}
            />
            <span
              className={`text-[10px] transition-colors duration-200 ${
                idx === currentIdx ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {t(PANEL_LABELS[panel])}
            </span>
          </button>
        ))}
      </nav>

      {/* Swipeable panel container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex flex-row h-full transition-transform duration-300"
          style={{
            width: `${PANELS.length * 100}%`,
            transform: `translateX(-${currentIdx * (100 / PANELS.length)}%)`,
          }}
        >
          {PANELS.map((panel) => (
            <div key={panel} className="h-full overflow-y-auto" style={{ width: `${100 / PANELS.length}%` }}>
              {panel === 'live' && <LivePanel />}
              {panel === 'rewards' && <RewardsPanel />}
              {panel === 'audience' && <AudiencePanel />}
              {panel === 'node' && <NodeEditorPanel />}
              {panel === 'boost' && <BoostPanel />}
              {panel === 'settings' && <SettingsPanel />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
