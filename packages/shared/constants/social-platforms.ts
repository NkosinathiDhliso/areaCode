/**
 * Social platforms a venue can link from its profile. Single source of truth
 * for the supported set, per-platform handle validation, and profile-URL
 * construction. Reused by the backend save route, the business editor, and the
 * consumer venue detail so the list and rules never drift.
 */

export type SocialPlatform = 'instagram' | 'tiktok' | 'facebook' | 'x' | 'youtube'

/** A venue's social handles, at most one per platform, stored without a leading @. */
export type SocialLinks = Partial<Record<SocialPlatform, string>>

export interface SocialPlatformConfig {
  platform: SocialPlatform
  /** Display label used in UI (never an emoji, per code-style rules). */
  label: string
  /** Input placeholder shown in the editor. */
  placeholder: string
  /** Allowed handle characters after a leading @ is stripped. */
  pattern: RegExp
  /** Builds the public profile URL from a bare handle (no leading @). */
  profileUrl: (handle: string) => string
}

/**
 * Ordered platform list. Order drives editor and detail rendering.
 */
export const SOCIAL_PLATFORMS: readonly SocialPlatformConfig[] = [
  {
    platform: 'instagram',
    label: 'Instagram',
    placeholder: 'yourhandle',
    pattern: /^[a-zA-Z0-9_.]{1,30}$/,
    profileUrl: (h) => `https://instagram.com/${h}`,
  },
  {
    platform: 'tiktok',
    label: 'TikTok',
    placeholder: 'yourhandle',
    pattern: /^[a-zA-Z0-9_.]{1,24}$/,
    profileUrl: (h) => `https://tiktok.com/@${h}`,
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    placeholder: 'yourpage',
    pattern: /^[a-zA-Z0-9.]{1,50}$/,
    profileUrl: (h) => `https://facebook.com/${h}`,
  },
  {
    platform: 'x',
    label: 'X',
    placeholder: 'yourhandle',
    pattern: /^[a-zA-Z0-9_]{1,15}$/,
    profileUrl: (h) => `https://x.com/${h}`,
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    placeholder: 'yourchannel',
    pattern: /^[a-zA-Z0-9_.-]{1,30}$/,
    profileUrl: (h) => `https://youtube.com/@${h}`,
  },
] as const

const CONFIG_BY_PLATFORM = SOCIAL_PLATFORMS.reduce<Record<SocialPlatform, SocialPlatformConfig>>(
  (acc, cfg) => {
    acc[cfg.platform] = cfg
    return acc
  },
  {} as Record<SocialPlatform, SocialPlatformConfig>,
)

export function getSocialPlatformConfig(platform: SocialPlatform): SocialPlatformConfig {
  return CONFIG_BY_PLATFORM[platform]
}

export function isSocialPlatform(value: string): value is SocialPlatform {
  return Object.prototype.hasOwnProperty.call(CONFIG_BY_PLATFORM, value)
}

/**
 * Validates and normalises one handle for a platform. Strips a leading @ and
 * surrounding whitespace. An empty string is valid and means "no handle set".
 */
export function validateSocialHandle(platform: SocialPlatform, input: string): { valid: boolean; handle: string } {
  const stripped = input.replace(/^@/, '').trim()
  if (stripped === '') return { valid: true, handle: '' }
  return { valid: getSocialPlatformConfig(platform).pattern.test(stripped), handle: stripped }
}

/** Public profile URL for a platform + handle (a leading @ on the handle is ignored). */
export function socialProfileUrl(platform: SocialPlatform, handle: string): string {
  return getSocialPlatformConfig(platform).profileUrl(handle.replace(/^@/, ''))
}

/**
 * Filters an untrusted value into a clean SocialLinks map: keeps only known
 * platforms whose handle is valid and non-empty. Safe to persist and to return
 * to clients. Not a masking fallback: malformed entries are dropped, not
 * silently coerced into wrong data.
 */
export function normaliseSocialLinks(input: unknown): SocialLinks {
  if (typeof input !== 'object' || input === null) return {}
  const out: SocialLinks = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isSocialPlatform(key) || typeof value !== 'string') continue
    const { valid, handle } = validateSocialHandle(key, value)
    if (valid && handle !== '') out[key] = handle
  }
  return out
}
