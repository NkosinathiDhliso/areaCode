/**
 * Cached reduced-motion query with live change listener.
 *
 * Module-level singleton: queries `prefers-reduced-motion: reduce` once,
 * caches the result, and updates it via a MediaQueryList `change` event.
 * Consumers call `reducedMotion()` for the current boolean without creating
 * a fresh matchMedia per invocation.
 *
 * Validates: Requirements 5.1, 5.2
 */

let cached = false

const mql: MediaQueryList | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

if (mql) {
  cached = mql.matches
  mql.addEventListener('change', (e: MediaQueryListEvent) => {
    cached = e.matches
  })
}

/** Returns the current `prefers-reduced-motion: reduce` value (cached). */
export function reducedMotion(): boolean {
  return cached
}
