import { haptic, prefersReducedMotion } from '@area-code/shared/lib/haptics'
import { useNavigationStore } from '@area-code/shared/stores/navigationStore'
import { Map, Trophy, Activity, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppRoute } from '../types'

type NavRoute = 'map' | 'ranks' | 'feed' | 'profile'

interface BottomNavProps {
  active: string
  onNavigate: (route: AppRoute) => void
  /**
   * Tab re-selection action: fired when the user taps the tab that is already
   * active. Lets a screen attach a secondary action to its own tab (Map toggles
   * the Peek_Carousel; the other tabs scroll their screen to top). Navigation is
   * suppressed in favour of this callback.
   */
  onReselect?: (route: NavRoute) => void
  /**
   * Long-press action. Return true if a shortcut ran, which suppresses the tap
   * that would otherwise navigate on release. Keeps the nav free of the host's
   * dependencies (e.g. hold Profile to flip the theme lives in App).
   */
  onLongPress?: (route: NavRoute) => boolean
}

const NAV_ITEMS: ReadonlyArray<{ route: NavRoute; labelKey: string; Icon: LucideIcon }> = [
  { route: 'map', labelKey: 'nav.map', Icon: Map },
  { route: 'ranks', labelKey: 'nav.leaderboard', Icon: Trophy },
  { route: 'feed', labelKey: 'nav.feed', Icon: Activity },
  { route: 'profile', labelKey: 'nav.profile', Icon: User },
]

const LONG_PRESS_MS = 500

export function BottomNav({ active, onNavigate, onReselect, onLongPress }: BottomNavProps) {
  const { t } = useTranslation()
  const setHasNavigated = useNavigationStore((s) => s.setHasNavigated)
  const hasNavigated = useNavigationStore((s) => s.hasNavigated)

  // Long-press timing. longPressFired gates the click that follows a hold so a
  // shortcut does not also navigate.
  const pressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)

  const activeIndex = NAV_ITEMS.findIndex((item) => item.route === active)
  const reduced = prefersReducedMotion()
  const slot = 100 / NAV_ITEMS.length

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  function startPress(route: NavRoute) {
    longPressFired.current = false
    clearPressTimer()
    pressTimer.current = window.setTimeout(() => {
      const handled = onLongPress?.(route) ?? false
      if (handled) {
        longPressFired.current = true
        haptic([10, 30, 10])
      }
    }, LONG_PRESS_MS)
  }

  function handleTap(route: NavRoute) {
    clearPressTimer()
    // A long-press already ran its shortcut; don't also navigate.
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    haptic(8)
    if (!hasNavigated) setHasNavigated()
    // Re-tapping the active tab runs its secondary action instead of navigating.
    if (route === active) {
      onReselect?.(route)
      return
    }
    onNavigate(route)
  }

  return (
    <nav
      className="app-bottom-nav relative flex-shrink-0 flex flex-row items-stretch justify-around z-50"
      style={{
        // Compact bar flush to the physical bottom edge. No safe-area margin,
        // so there is no strip below it and no gap. Icons are centred in the
        // 49px bar, so they stay clear of the home indicator, which floats over
        // the bar's bottom few pixels (same --bg-base colour). Trade-off: the
        // lowest sliver of the tab row sits in the system gesture zone.
        height: 'var(--nav-height)',
      }}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Sliding active indicator. Slides between tabs; hidden on sub-screens
          where no tab is active (activeIndex < 0). */}
      <span
        aria-hidden="true"
        className="absolute z-0 rounded-full pointer-events-none"
        style={{
          width: '60px',
          height: '34px',
          top: 'calc((var(--nav-height) - 34px) / 2)',
          left: `${(activeIndex + 0.5) * slot}%`,
          transform: 'translateX(-50%)',
          background: 'var(--bg-raised)',
          opacity: activeIndex < 0 ? 0 : 1,
          transition: reduced ? 'opacity 0.2s ease' : 'left 0.34s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease',
        }}
      />
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.route
        return (
          <button
            key={item.route}
            onPointerDown={() => startPress(item.route)}
            onPointerUp={clearPressTimer}
            onPointerLeave={clearPressTimer}
            onPointerCancel={clearPressTimer}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => handleTap(item.route)}
            className={`relative z-10 flex flex-col items-center justify-center flex-1 select-none transition-transform duration-150 active:scale-90 ${
              isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
            style={{ touchAction: 'manipulation' }}
            aria-current={isActive ? 'page' : undefined}
            aria-label={t(item.labelKey)}
          >
            <item.Icon size={24} strokeWidth={isActive ? 2.5 : 1.5} />
            <span className="text-[10px] mt-0.5 leading-none">{t(item.labelKey)}</span>
          </button>
        )
      })}
    </nav>
  )
}
