import type { BusinessTier, Tier } from '../types'

const TIER_ORDER: Tier[] = ['local', 'regular', 'fixture', 'institution', 'legend']

// ─── Feature flags ──────────────────────────────────────────────────────────
//
// Boolean feature flags read from a backend-served config (R12.1) with a
// safe fallback to the registered default whenever the flag store is
// unreachable (R12.3). Defaults to `false` in every environment (R12.2)
// unless explicitly overridden at runtime or via env var.
//
// Reads are safe on web, business, and backend. Every read is wrapped in a
// try/catch so a malformed override or missing env subsystem can never
// crash callers - the default value wins.

export type FeatureFlagName = 'live_vibe_on_map' | 'live_vibe_declaration'

const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlagName, boolean>> = Object.freeze({
  live_vibe_on_map: false,
  live_vibe_declaration: false,
})

const featureFlagOverrides = new Map<FeatureFlagName, boolean>()

/**
 * Set or clear a runtime override for a feature flag. Used by tests and by
 * the future backend-served config push path. Pass `undefined` to clear.
 */
export function setFeatureFlagOverride(name: FeatureFlagName, value: boolean | undefined): void {
  if (value === undefined) {
    featureFlagOverrides.delete(name)
    return
  }
  featureFlagOverrides.set(name, value)
}

/** Clear every override. Test-only helper. */
export function clearFeatureFlagOverrides(): void {
  featureFlagOverrides.clear()
}

function flagEnvKey(name: FeatureFlagName): string {
  return `AREA_CODE_FLAG_${name.toUpperCase()}`
}

function flagViteEnvKey(name: FeatureFlagName): string {
  return `VITE_FLAG_${name.toUpperCase()}`
}

function readFromEnv(name: FeatureFlagName): boolean | undefined {
  // Backend / Node: process.env (Lambda runtime, vitest). Reach for
  // `process` via `globalThis` so this module can compile under the web
  // tsconfig, which doesn't include `@types/node` and would otherwise
  // raise TS2591 on a bare `process` reference. The web bundle never
  // takes this branch at runtime because `process` is undefined there.
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    if (proc?.env) {
      const raw = proc.env[flagEnvKey(name)]
      if (raw === 'true') return true
      if (raw === 'false') return false
    }
  } catch {
    // process is not available in this runtime - ignore.
  }

  // Web / business: import.meta.env (Vite). Access as a plain member
  // expression (no optional chaining on `import.meta`) so Vite statically
  // replaces it at build time; the `(import.meta)?.env` form is NOT replaced
  // and reads the browser's native, env-less import.meta. The try/catch keeps
  // non-Vite contexts (Node tests, SSR shims) safe.
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    if (env) {
      const raw = env[flagViteEnvKey(name)]
      if (raw === 'true') return true
      if (raw === 'false') return false
    }
  } catch {
    // import.meta unavailable - ignore.
  }

  return undefined
}

/**
 * Read a feature flag's current value. Returns the registered default on any
 * read failure, mirroring R12.3's unreachable-store fallback semantics.
 */
export function getFeatureFlag(name: FeatureFlagName): boolean {
  try {
    const override = featureFlagOverrides.get(name)
    if (typeof override === 'boolean') return override

    const fromEnv = readFromEnv(name)
    if (typeof fromEnv === 'boolean') return fromEnv
  } catch {
    // Any unexpected throw → fall through to the default.
  }
  return FEATURE_FLAG_DEFAULTS[name]
}

/**
 * Typed helper for the `live_vibe_on_map` flag (Requirement 12).
 *
 * Returns `false` by default and whenever the flag store is unreachable.
 * Safe to call from web, business, and backend contexts. Despite the `use*`
 * naming convention, this is a plain function - it does not subscribe to
 * React state and may be called outside a component.
 */
export function useLiveVibeOnMap(): boolean {
  return getFeatureFlag('live_vibe_on_map')
}

/**
 * Typed helper for the `live_vibe_declaration` flag (live-vibe-declaration
 * Requirement 10).
 *
 * Gates the presence-is-truth precedence in which honest present crowd beats
 * the declared promise once the Presence_Floor is crossed. Returns `false` by
 * default and whenever the flag store is unreachable (R10.1, R10.2), so the
 * feature ships dark and the resolver keeps the legacy live-vibe-on-map
 * precedence until the flag is flipped per environment.
 *
 * Safe to call from web, business, and backend contexts. Despite the `use*`
 * naming convention, this is a plain function - it does not subscribe to
 * React state and may be called outside a component.
 */
export function useLiveVibeDeclaration(): boolean {
  return getFeatureFlag('live_vibe_declaration')
}

function tierAtLeast(tier: Tier | null, minTier: Tier): boolean {
  if (!tier) return false
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(minTier)
}

// Consumer feature gates
export function canCheckIn(tier: Tier | null): boolean {
  return tier !== null // Must be authenticated (any tier)
}

export function canClaimRewards(tier: Tier | null): boolean {
  return tier !== null
}

export function canViewWhoIsHere(tier: Tier | null): boolean {
  return tierAtLeast(tier, 'regular')
}

export function canParticipateInLeaderboard(tier: Tier | null): boolean {
  return tier !== null
}

export function canFollowUsers(tier: Tier | null): boolean {
  return tier !== null
}

// Business feature gates
export function getMaxNodes(tier: BusinessTier): number {
  switch (tier) {
    case 'pro':
      return Infinity
    case 'growth':
      return 5
    default:
      return 1
  }
}

export function getMaxActiveRewards(tier: BusinessTier): number {
  switch (tier) {
    case 'pro':
      return Infinity
    case 'growth':
      return 10
    default:
      return 3
  }
}

export function getMaxStaffAccounts(tier: BusinessTier): number {
  switch (tier) {
    case 'pro':
      return Infinity
    case 'growth':
      return 5
    default:
      return 2
  }
}

export function hasAudienceAnalytics(tier: BusinessTier): boolean {
  return tier === 'growth' || tier === 'pro'
}

export function hasExportAnalytics(tier: BusinessTier): boolean {
  return tier === 'pro'
}

export function getIncludedBoosts(tier: BusinessTier): number {
  switch (tier) {
    case 'pro':
      return Infinity
    case 'growth':
      return 3
    default:
      return 0
  }
}
