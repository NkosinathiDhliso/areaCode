import { useTranslation } from 'react-i18next'
import { useNavigationStore } from '@area-code/shared/stores/navigationStore'
import type { AppRoute } from '../types'

type NavRoute = 'map' | 'rewards' | 'leaderboard' | 'feed' | 'profile'

interface BottomNavProps {
  active: string
  onNavigate: (route: AppRoute) => void
}

/** SVG-safe icon characters — no emoji per CLAUDE.md rule 5. */
const NAV_ITEMS: ReadonlyArray<{ route: NavRoute; labelKey: string; icon: string }> = [
  { route: 'map', labelKey: 'nav.map', icon: '◉' },
  { route: 'rewards', labelKey: 'nav.rewards', icon: '★' },
  { route: 'leaderboard', labelKey: 'nav.leaderboard', icon: '▲' },
  { route: 'feed', labelKey: 'nav.feed', icon: '◎' },
  { route: 'profile', labelKey: 'nav.profile', icon: '●' },
]

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  const { t } = useTranslation()
  const setHasNavigated = useNavigationStore((s) => s.setHasNavigated)
  const hasNavigated = useNavigationStore((s) => s.hasNavigated)

  function handleTap(route: NavRoute) {
    if (!hasNavigated) setHasNavigated()
    onNavigate(route)
  }

  return (
    <nav
      className="flex flex-row items-center justify-around glass border-t border-[var(--glass-border)] px-2"
      style={{ height: 'var(--nav-height)' }}
      role="navigation"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.route
        return (
          <button
            key={item.route}
            onClick={() => handleTap(item.route)}
            className={`flex flex-col items-center justify-center flex-1 py-2 transition-colors duration-150 ${
              isActive
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-muted)]'
            }`}
            aria-current={isActive ? 'page' : undefined}
            aria-label={t(item.labelKey)}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-[10px] mt-0.5">{t(item.labelKey)}</span>
          </button>
        )
      })}
    </nav>
  )
}
