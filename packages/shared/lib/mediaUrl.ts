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
 *
 * IMPORTANT: access `import.meta.env` as a plain member expression (no
 * optional chaining on `import.meta`). Vite statically replaces
 * `import.meta.env` at build time; the optional-chained form
 * `(import.meta)?.env` compiles to `s=import.meta; s.env`, which Vite does NOT
 * replace, so the browser reads its native `import.meta` (no `env`) and every
 * `VITE_*` read comes back undefined. The try/catch covers non-Vite runtimes.
 */
function readCdnBase(): string | null {
  try {
    // Access the bare `import.meta.env` object (no optional chaining on
    // `import.meta`). Vite replaces the bare `import.meta.env` reference with
    // its injected env object at build time, so the value is present in prod.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    const raw = env?.['VITE_CDN_URL']
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  } catch {
    // import.meta / env unavailable in this runtime - fall through.
  }
  return null
}

/**
 * Join a CDN base and an object key into a full media URL. Pure function (no
 * env access), so it is directly unit-testable.
 *
 * Returns `null` when the base is unset/empty or the key is empty. If the key
 * is already an absolute URL (http/https), it is returned as-is. Otherwise the
 * base and key are joined with exactly one slash, tolerating a trailing slash
 * on the base and a leading slash on the key.
 */
export function buildMediaUrl(base: string | null | undefined, key: string | null | undefined): string | null {
  if (typeof key !== 'string' || key.trim() === '') return null

  const trimmedKey = key.trim()
  if (/^https?:\/\//i.test(trimmedKey)) return trimmedKey

  if (typeof base !== 'string' || base.trim() === '') return null

  return `${base.trim().replace(/\/+$/, '')}/${trimmedKey.replace(/^\/+/, '')}`
}

/**
 * Build the full media URL for a given object key, using the configured CDN
 * base (`VITE_CDN_URL`). Thin wrapper over {@link buildMediaUrl}; the env read
 * is build-time (statically replaced by Vite) so it is exercised by build/e2e,
 * not stubbed unit tests. Unit-test {@link buildMediaUrl} directly.
 */
export function mediaUrl(key: string | null | undefined): string | null {
  return buildMediaUrl(readCdnBase(), key)
}
