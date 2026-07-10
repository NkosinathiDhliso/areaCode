import { ImageOff } from 'lucide-react'
import { useEffect } from 'react'

/**
 * Explicit "Photos unavailable" state for a photo surface whose media key is
 * present but whose serving URL could not be resolved (`mediaUrl` returned
 * null because `VITE_CDN_URL` is unset). This is a designed visible state, not
 * a silent skip: R5.3 requires photo surfaces to never show
 * success-without-preview. See `.kiro/specs/deployment-parity` and
 * `no-fallbacks-no-legacy.md`.
 *
 * Render this only when a key exists but the URL is null. A genuinely absent
 * photo (no key) keeps its own empty/placeholder state.
 */

// Log the CDN-unset condition once per app session, not once per render.
let hasLoggedUnavailable = false

export interface PhotoUnavailableProps {
  /** Sizing and margin classes for the slot this fills, e.g. "w-full h-40 mb-4". */
  className?: string
  /** Compact variant for tiny thumbnails (icon only, no copy). */
  variant?: 'full' | 'compact'
}

export function PhotoUnavailable({ className = '', variant = 'full' }: PhotoUnavailableProps) {
  useEffect(() => {
    if (hasLoggedUnavailable) return
    hasLoggedUnavailable = true
    console.warn(
      '[mediaUrl] VITE_CDN_URL is unset: venue photos cannot be served. ' +
        'Rendering the Photos unavailable state (deployment-parity R5).',
    )
  }, [])

  if (variant === 'compact') {
    return (
      <div
        role="img"
        aria-label="Photos unavailable"
        className={`flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] ${className}`}
      >
        <ImageOff size={16} strokeWidth={1.5} className="text-[var(--text-muted)]" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div
      role="img"
      aria-label="Photos unavailable"
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] px-6 text-center ${className}`}
    >
      <ImageOff size={28} strokeWidth={1.5} className="text-[var(--text-muted)] opacity-60" aria-hidden="true" />
      <span className="text-[var(--text-secondary)] text-sm font-medium">Photos unavailable</span>
      <span className="text-[var(--text-muted)] text-xs">Photo serving is not configured right now.</span>
    </div>
  )
}
