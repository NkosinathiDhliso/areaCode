import { useTranslation } from 'react-i18next'
import { useNavigationStore } from '@area-code/shared/stores/navigationStore'
import { Map, Gift, Trophy, Activity, User } from 'lucide-react'
import type { AppRoute } from '../types'
import type { LucideIcon } from 'lucide-react'

type NavRoute = 'map' | 'gets' | 'ranks' | 'feed' | 'profile'

interface BottomNavProps {
  active: string
  onNavigate: (route: AppRoute) => void
}

const NAV_ITEMS: ReadonlyArray<{ route: NavRoute; labelKey: string; Icon: LucideIcon }> = [
  { route: 'map', labelKey: 'nav.map', Icon: Map },
  { route: 'gets', labelKey: 'nav.rewards', Icon: Gift },
  { route: 'ranks', labelKey: 'nav.leaderboard', Icon: Trophy },
  { route: 'feed', labelKey: 'nav.feed', Icon: Activity },
  { route: 'profile', labelKey: 'nav.profile', Icon: User },
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
      className="app-bottom-nav flex-shrink-0 flex flex-row items-center justify-around glass border-t border-[var(--glass-border)] px-2 z-50"
      style={{
        height: 'calc(var(--nav-height) + var(--safe-area-bottom))',
        paddingBottom: 'var(--safe-area-bottom)',
      }}
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
              isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
            aria-current={isActive ? 'page' : undefined}
            aria-label={t(item.labelKey)}
          >
            <item.Icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
            <span className="text-[10px] mt-0.5">{t(item.labelKey)}</span>
          </button>
        )
      })}
    </nav>
  )
}
