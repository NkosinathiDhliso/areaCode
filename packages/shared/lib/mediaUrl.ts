/**
 * Resolve the public serving URL for a media object key.
 *
 * The CDN base is `VITE_CDN_URL` (the Media_CDN: CloudFront in front of the
 * private `s3_media` bucket). When the base is unset or empty, this returns
 * `null` so callers can render an explicit "unavailable" state rather than a
 * silent success-without-preview (see `.kiro/specs/deployment-parity`, R5.3,
 * and `no-fallbacks-no-legacy.md`). There is no fallback base.
 *
 * Read defensively so this module can also be imported from non-Vite contexts
 * (Node tests, SSR shims) without throwing on `import.meta`.
 */
function readCdnBase(): string | null {
  try {
    const meta = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env
    const raw = meta?.['VITE_CDN_URL']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  } catch {
    // import.meta unavailable in this runtime - fall through.
  }
  return null
}

/**
 * Build the full media URL for a given object key.
 *
 * Returns `null` when the CDN base is unset/empty or the key is empty.
 * If the key is already an absolute URL (http/https), it is returned as-is.
 * Otherwise the base and key are joined with exactly one slash, tolerating a
 * trailing slash on the base and a leading slash on the key.
 */
export function mediaUrl(key: string | null | undefined): string | null {
  if (typeof key !== 'string' || key.trim() === '') return null

  const trimmedKey = key.trim()
  if (/^https?:\/\//i.test(trimmedKey)) return trimmedKey

  const base = readCdnBase()
  if (base === null) return null

  return `${base.replace(/\/+$/, '')}/${trimmedKey.replace(/^\/+/, '')}`
}
