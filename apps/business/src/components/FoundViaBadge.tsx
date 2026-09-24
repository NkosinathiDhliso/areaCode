import { OPEN_SOURCE_PHRASE, type FoundVia } from '@area-code/shared/constants/attribution'

interface FoundViaBadgeProps {
  foundVia: FoundVia
}

/**
 * The Found_You badge (proof-of-demand R4.3, R4.4).
 *
 * Renders nothing for a walk-in. "Already in the room" is a real and useful
 * fact, but it is the absence of a source, so badging it would read as a claim
 * Area Code never measured. The source phrase comes from the one shared map
 * `OPEN_SOURCE_PHRASE`, the same phrases the Receipt sentences use, so a source
 * is never described two ways.
 *
 * Decorative, so it is exempt from the 44px touch-target rule.
 */
export function FoundViaBadge({ foundVia }: FoundViaBadgeProps) {
  if (foundVia === 'walk_in') return null

  return (
    <span
      data-testid={`found-via-badge-${foundVia}`}
      className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{
        color: 'var(--accent)',
        backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
      }}
    >
      Found you {OPEN_SOURCE_PHRASE[foundVia]}
    </span>
  )
}
