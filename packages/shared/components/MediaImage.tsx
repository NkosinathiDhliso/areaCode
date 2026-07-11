import { useEffect, useState } from 'react'

import { PhotoUnavailable, type PhotoUnavailableProps } from './PhotoUnavailable'

interface MediaImageProps {
  /** Resolved serving URL (already non-null; callers gate on `mediaUrl(...)`). */
  src: string
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  decoding?: 'async' | 'sync' | 'auto'
  /** Sizing/margin classes for the fallback shown if the image fails to load. */
  fallbackClassName?: string
  fallbackVariant?: PhotoUnavailableProps['variant']
}

/**
 * A venue/media `<img>` that degrades to the `PhotoUnavailable` honest state
 * when the image fails to load at runtime, instead of leaking the browser's
 * broken-image icon.
 *
 * `mediaUrl` already returns null (→ callers render `PhotoUnavailable`) when the
 * CDN base is unset. This component covers the other failure: the URL resolves
 * but the object is missing/unreachable (404/403, CloudFront not serving, or a
 * processed `.webp` that was never produced). Both cases now surface the same
 * designed state rather than a broken glyph. This is user-facing graceful
 * degradation, not a silent failure mask (see `no-fallbacks-no-legacy.md`).
 */
export function MediaImage({
  src,
  alt,
  className,
  loading,
  decoding,
  fallbackClassName = '',
  fallbackVariant = 'full',
}: MediaImageProps) {
  const [failed, setFailed] = useState(false)

  // Reset on src change so a re-upload (new key) gets a fresh load attempt
  // rather than staying stuck on the previous failure.
  useEffect(() => {
    setFailed(false)
  }, [src])

  if (failed) {
    return <PhotoUnavailable className={fallbackClassName} variant={fallbackVariant} />
  }

  return (
    <img
      src={src}
      alt={alt}
      {...(loading ? { loading } : {})}
      {...(decoding ? { decoding } : {})}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
