import { create } from 'zustand'

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

/** Reads the persisted preference, defaulting to 'auto'. */
function readStoredPreference(): ThemePreference {
  const stored = storage.get(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
  return 'auto'
}

interface ThemeStore {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (pref: ThemePreference) => void
  /** Re-evaluate the SAST auto day/night flip. Driven by the 60s interval. */
  refresh: () => void
}

const initialPreference = readStoredPreference()

/**
 * Shared theme store. The basemap style swap (`useMapInit`), the theme toggle
 * UI (`ProfileScreen`), and the app shell (`App`) all subscribe to this one
 * store, so a manual flip in any surface re-renders every consumer - the map
 * included. Backing this with component-local `useState` was the bug: each
 * `useTheme()` caller held its own copy, so toggling in Profile updated the CSS
 * (via `applyTheme`) but left the map on its stale style.
 */
export const useThemeStore = create<ThemeStore>((set, get) => ({
  preference: initialPreference,
  resolved: resolveTheme(initialPreference),
  setPreference: (pref) => {
    storage.set(STORAGE_KEY, pref)
    const next = resolveTheme(pref)
    applyTheme(next)
    set({ preference: pref, resolved: next })
  },
  refresh: () => {
    const { preference, resolved } = get()
    if (preference !== 'auto') return
    const next = resolveTheme('auto')
    if (next === resolved) return
    applyTheme(next)
    set({ resolved: next })
  },
}))

// Apply the initial theme once at module load so the first paint is correct.
applyTheme(useThemeStore.getState().resolved)

// Single module-level interval drives the SAST auto day/night flip for every
// consumer. One source of truth, no per-hook intervals.
if (typeof window !== 'undefined') {
  setInterval(() => useThemeStore.getState().refresh(), 60_000)
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
 * The shared store re-evaluates every 60s when on 'auto' to catch the
 * transition, and every consumer re-renders off the same `resolved` value.
 */
export function useTheme() {
  const preference = useThemeStore((s) => s.preference)
  const resolved = useThemeStore((s) => s.resolved)
  const setPreference = useThemeStore((s) => s.setPreference)
  return { preference, resolved, setPreference } as const
}
