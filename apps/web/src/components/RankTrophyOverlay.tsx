import { useCallback, useEffect, useRef, type CSSProperties } from 'react'

import { getTierLabel } from '@area-code/shared/constants/tier-levels'
import type { Tier } from '@area-code/shared/types'

import { reducedMotion } from '../lib/reducedMotion'
import {
  getTrophyDescriptor,
  TROPHY_MAX_DURATION_MS,
  TROPHY_REDUCED_MOTION_DURATION_MS,
  type TrophyDescriptor,
} from '../lib/trophyAnimations'
import './RankTrophyOverlay.css'

/**
 * `RankTrophyOverlay` - the Trophy_Tap celebration (Hidden_Delight HD-2).
 *
 * A full-screen decorative layer, rendered by `ProfileScreen`, that plays the
 * user's own current rank as an inline SVG badge animated with CSS keyframes.
 * No GIF, video, canvas, or Lottie: SVG + CSS keeps the asset tiny, themeable
 * via the existing `--tier-*` tokens, and cheap on mid-range Android
 * (Requirement 5.1). Every effect animates `transform`/`opacity` only and takes
 * its colour from a CSS variable (Requirement 5.2).
 *
 * Spectacle escalates with rank from a per-tier descriptor table
 * (`trophyAnimations.ts`, design D7): Local pops with a single ring, and each
 * step up layers on sparks, orbiting sparks, a glow pulse, light rays, a
 * particle fountain, a starfield, and the Legend shimmer sweep (Requirement
 * 5.3). It renders above the bottom nav and respects safe areas, and it never
 * unmounts the profile screen behind it (Requirement 5.8). It only ever plays
 * the rank passed in as `tier` (Requirement 5.9); it cannot select a rank.
 *
 * This is the base layer (task 6.1). Later tasks extend this same file:
 *  - 6.2 dismissal: click anywhere, Escape, per-rank auto-dismiss timer, and
 *    the `TROPHY_MAX_DURATION_MS` hard cap, all cleaned up on unmount.
 *  - 6.3 reduced-motion: a flat fade variant (`TROPHY_REDUCED_MOTION_DURATION_MS`).
 *  - 6.4 accessibility: `aria-hidden` content, no focus trap, no sound.
 * The render is composed from small effect helpers so those tasks can extend
 * behaviour without reshaping the markup.
 */
export interface RankTrophyOverlayProps {
  /** The user's own current rank. The overlay plays exactly this rank. */
  tier: Tier
  /** Whether the celebration is mounted and playing. */
  playing: boolean
  /** Called when the celebration has run its course or is dismissed. */
  onDone: () => void
}

/** `--tier-*` colour token for a rank. Matches the badge tokens in tokens.css. */
function tierColorVar(tier: Tier): string {
  return `var(--tier-${tier})`
}

/** Build an array of N indices for particle mapping. */
function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

/**
 * Inline SVG rank badge: a ringed star medallion filled with the tier colour.
 * `staticVariant` swaps the spring pop for the reduced-motion flat fade
 * (Requirement 5.5); the markup and colour are identical either way.
 */
function TrophyBadge({ color, staticVariant = false }: { color: string; staticVariant?: boolean }) {
  return (
    <svg
      className={staticVariant ? 'trophy-badge-static' : 'trophy-badge'}
      width={132}
      height={132}
      viewBox="0 0 100 100"
      fill="none"
      style={{ color }}
    >
      <circle cx="50" cy="50" r="44" fill="currentColor" opacity="0.16" />
      <circle cx="50" cy="50" r="44" stroke="currentColor" strokeWidth="3" opacity="0.7" />
      <path
        d="M50 28 L55.29 42.72 L70.92 43.2 L58.56 52.78 L62.93 67.8 L50 59 L37.07 67.8 L41.44 52.78 L29.08 43.2 L44.71 42.72 Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * The escalating effect layers for one rank, driven by its descriptor. Each
 * block is gated on a count or flag, so a rank renders only the effects design
 * D7 assigns it. All nodes are `pointer-events: none` decoration.
 */
function TrophyEffects({ descriptor }: { descriptor: TrophyDescriptor }) {
  const { rippleRings, sparkBurst, orbitingSparks, rays, fountainParticles, starfieldParticles, glowPulse } = descriptor

  return (
    <>
      {glowPulse && <span className="trophy-fx trophy-glow" />}

      {range(rippleRings).map((i) => (
        <span key={`ripple-${i}`} className="trophy-fx trophy-ripple" style={{ '--i': i } as CSSProperties} />
      ))}

      {range(sparkBurst).map((i) => (
        <span
          key={`spark-${i}`}
          className="trophy-fx trophy-spark"
          style={{ '--angle': `${(360 / sparkBurst) * i}deg` } as CSSProperties}
        />
      ))}

      {range(orbitingSparks).map((i) => (
        <span key={`orbit-${i}`} className="trophy-fx trophy-orbit" style={{ '--i': i } as CSSProperties}>
          <span />
        </span>
      ))}

      {range(rays).map((i) => (
        <span
          key={`ray-${i}`}
          className="trophy-fx trophy-ray"
          style={{ '--i': i, '--angle': `${(360 / (rays || 1)) * i}deg` } as CSSProperties}
        />
      ))}

      {range(fountainParticles).map((i) => (
        <span
          key={`fountain-${i}`}
          className="trophy-fx trophy-fountain"
          style={{ '--i': i, '--dx': `${(i % 2 === 0 ? 1 : -1) * (8 + (i % 3) * 10)}px` } as CSSProperties}
        />
      ))}

      {range(starfieldParticles).map((i) => (
        <span
          key={`star-${i}`}
          className="trophy-fx trophy-star"
          style={{ '--i': i, '--angle': `${(360 / (starfieldParticles || 1)) * i}deg` } as CSSProperties}
        />
      ))}
    </>
  )
}

export function RankTrophyOverlay({ tier, playing, onDone }: RankTrophyOverlayProps) {
  // Hooks run unconditionally, above the not-playing early return (code-style:
  // hooks above conditional returns). The descriptor lookup is total and cheap.
  const descriptor = getTrophyDescriptor(tier)
  const color = tierColorVar(tier)

  // Reduced-motion is a distinct correct path, not a fallback (Requirement
  // 5.5, design D7): every rank plays the same flat fade over
  // TROPHY_REDUCED_MOTION_DURATION_MS with no particles, rays, or shimmer. The
  // shared cached helper (lib/reducedMotion) is the one source of truth for the
  // media query across the web app.
  const prefersReducedMotion = reducedMotion()
  const autoDismissMs = prefersReducedMotion ? TROPHY_REDUCED_MOTION_DURATION_MS : descriptor.durationMs

  // onDone must fire at most once per play. A ref guards double-fire (e.g. a
  // click that lands in the same tick as the auto-dismiss timer) and is reset
  // whenever a new play begins. onDone is held in a ref so its identity changing
  // does not restart the dismissal timers mid-play.
  const doneFiredRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const fireDone = useCallback(() => {
    if (doneFiredRef.current) return
    doneFiredRef.current = true
    onDoneRef.current()
  }, [])

  // Dismissal (design D6, Requirement 5.4): Escape keydown, a per-rank
  // auto-dismiss timer of the descriptor's duration, and a TROPHY_MAX_DURATION_MS
  // hard-cap guard so the overlay can never persist. All listeners and timers
  // are cleaned up on unmount and whenever `playing` becomes false.
  useEffect(() => {
    if (!playing) return

    doneFiredRef.current = false

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') fireDone()
    }
    window.addEventListener('keydown', onKeyDown)

    const autoTimer = window.setTimeout(fireDone, autoDismissMs)
    const hardCapTimer = window.setTimeout(fireDone, TROPHY_MAX_DURATION_MS)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(autoTimer)
      window.clearTimeout(hardCapTimer)
    }
  }, [playing, autoDismissMs, fireDone])

  // The overlay is a pure overlay: when not playing it renders nothing, so the
  // profile screen behind it is never disturbed or unmounted (Requirement 5.8).
  if (!playing) return null

  return (
    <div
      className="trophy-overlay fixed inset-0"
      // Purely decorative celebration (Requirement 5.7): assistive tech ignores
      // the whole layer. No information exists only inside the animation, so
      // there is nothing here for a screen reader to miss. Focus is never
      // trapped or moved (no autofocus, no .focus() call anywhere), and there is
      // no sound (Requirement 5.6). Because the layer is aria-hidden and dismiss-
      // on-any-click, the click target is a plain decorative div: adding an
      // interactive role would demand a label and contradict aria-hidden. Escape
      // (wired at the window level above) covers keyboard dismissal, so no
      // element-level key handler is needed.
      aria-hidden="true"
      style={{
        // Above BottomNav (z-50) and the toast layer; a celebratory takeover.
        zIndex: 10000,
        // Respect notches and the home indicator on both axes.
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        // Per-tier colour handed to the CSS layers via one custom property.
        ['--trophy-color' as string]: color,
        // Reduced-motion fade length, kept in sync with the auto-dismiss timer.
        ['--trophy-fade-ms' as string]: `${TROPHY_REDUCED_MOTION_DURATION_MS}ms`,
      }}
      // Tap anywhere dismisses early (Requirement 5.4). Escape and the timers
      // are wired in the effect above.
      onClick={fireDone}
    >
      <div className="trophy-backdrop" />

      <div className="trophy-stage">
        {/* Relative frame so every effect layer centers on the badge. Under
            reduced motion the effect layers and shimmer are omitted entirely
            (no particles, rays, or shimmer sweep) and the badge and label play
            a single flat fade instead (Requirement 5.5). */}
        <div style={{ position: 'relative' }}>
          {!prefersReducedMotion && <TrophyEffects descriptor={descriptor} />}
          <TrophyBadge color={color} staticVariant={prefersReducedMotion} />
          {!prefersReducedMotion && descriptor.shimmerSweep && <span className="trophy-shimmer" style={{ color }} />}
        </div>

        <span
          className={`${prefersReducedMotion ? 'trophy-label-static' : 'trophy-label'} font-[Syne] text-2xl font-bold`}
          style={{ color: 'var(--text-primary)' }}
        >
          {getTierLabel(tier)}
        </span>
      </div>
    </div>
  )
}
