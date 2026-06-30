import { useEffect, useState, useCallback } from 'react'
import { storage } from '../lib/storage'

/**
 * Theme preference: 'auto' follows SAST time-of-day,
 * 'light'/'dark' are manual overrides persisted in localStorage.
 */
export type ThemePreference = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'area-code:theme-preference'
const SAST_OFFSET = 2 // UTC+2
const LIGHT_START = 6 // 06:00 SAST
const LIGHT_END = 18 // 18:00 SAST

/** Theme-color values matching --bg-base for each mode. */
const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#0c1018',
  light: '#f0ece6',
}

/** Returns the current hour in SAST (0-23). */
function getSASTHour(): number {
  const now = new Date()
  const utcHour = now.getUTCHours()
  return (utcHour + SAST_OFFSET) % 24
}

/** Resolves 'auto' to light/dark based on SAST time. */
function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'auto') return pref
  const hour = getSASTHour()
  return hour >= LIGHT_START && hour < LIGHT_END ? 'light' : 'dark'
}

/** Applies the theme to the document root element and browser chrome. */
function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)

  // Repaint the <html> backstop to match the active (time-based) theme.
  //
  // index.html sets a pre-hydration <html> background via an *unlayered* inline
  // <style> that follows the OS `prefers-color-scheme`. That rule outranks the
  // theme-aware `html { background-color: var(--bg-base) }` in app.css (which
  // lives in Tailwind's low-priority @layer base), so the backstop would stay
  // stuck on the OS colour. When the OS is light but our time-based theme is
  // dark (evening), the home-indicator / safe-area strip below the 100dvh app
  // shell then shows a beige band under the bottom nav. An inline element style
  // outranks both rules, keeping the backstop honest to the live theme.
  document.documentElement.style.backgroundColor = THEME_COLORS[theme]

  // Update all theme-color meta tags so browser chrome / status bar matches
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach((meta) => {
    meta.setAttribute('content', THEME_COLORS[theme])
  })
}

/**
 * Time-of-day theme hook for Area Code.
 *
 * Default behaviour ('auto'):
 *   06:00-18:00 SAST → light mode
 *   18:00-06:00 SAST → dark mode
 *
 * Users can override via setPreference('light' | 'dark' | 'auto').
 * Override persists in localStorage under 'area-code:theme-preference'.
 * Re-evaluates every 60s when on 'auto' to catch the transition.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const stored = storage.get(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
    return 'auto'
  })

  // `resolved` is React state, not a per-render derivation. The auto day/night
  // transition fires from a `setInterval` (no user interaction, no other state
  // change), so it MUST push into state to re-render consumers. A previously
  // derived `resolved = resolveTheme(preference)` only updated the DOM from the
  // interval and left React unaware - so the map (which swaps its basemap style
  // off `resolved`) stayed on the light style after the 18:00 SAST flip even
  // though the CSS chrome went dark. Keeping it in state fixes that.
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference))

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref)
    storage.set(STORAGE_KEY, pref)
    const next = resolveTheme(pref)
    setResolved(next)
    applyTheme(next)
  }, [])

  // Keep `resolved` and the DOM in sync whenever the preference changes.
  useEffect(() => {
    const next = resolveTheme(preference)
    setResolved(next)
    applyTheme(next)
  }, [preference])

  // Re-evaluate every 60s when on 'auto' to catch day/night transitions. This
  // updates state (not just the DOM) so every consumer - the map included -
  // re-renders and reacts to the flip.
  useEffect(() => {
    if (preference !== 'auto') return

    const interval = setInterval(() => {
      const next = resolveTheme('auto')
      setResolved(next)
      applyTheme(next)
    }, 60_000)

    return () => clearInterval(interval)
  }, [preference])

  return { preference, resolved, setPreference } as const
}
