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

/** Returns the current hour in SAST (0–23). */
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
 *   06:00–18:00 SAST → light mode
 *   18:00–06:00 SAST → dark mode
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

  const resolved = resolveTheme(preference)

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref)
    storage.set(STORAGE_KEY, pref)
    applyTheme(resolveTheme(pref))
  }, [])

  // Apply theme on mount and when preference changes
  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  // Re-evaluate every 60s when on 'auto' to catch day/night transitions
  useEffect(() => {
    if (preference !== 'auto') return

    const interval = setInterval(() => {
      applyTheme(resolveTheme('auto'))
    }, 60_000)

    return () => clearInterval(interval)
  }, [preference])

  return { preference, resolved, setPreference } as const
}
