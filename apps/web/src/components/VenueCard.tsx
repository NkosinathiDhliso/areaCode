import type { NodeCategory } from '@area-code/shared/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import type { VenueCardVM } from '../lib/carouselConstants'
import { getPulseStateColour } from '../lib/mapHelpers'

import { ArchetypeGlyph } from './ArchetypeGlyph'

/**
 * Compact Browse_Mode card for the Peek-Carousel strip.
 *
 * Renders the three comparison signals a consumer browses on (R1.2): the venue
 * name, its Live_Check_In_Count (from `mapStore.checkInCounts`, surfaced via the
 * derived {@link VenueCardVM}), and the venue's archetype glyph painted in the
 * venue's Pulse_State colour. When the live count is zero the numeric count is
 * replaced by the "be the first in" affordance (R4.6 / Property 2) so an empty
 * venue reads as an invitation rather than a dead end.
 *
 * The card is a pure presentation shell over the {@link VenueCardVM}; selection,
 * camera, and commit wiring live in the `PeekCarousel` host and
 * `useCarouselSelection` hook. It accepts an optional `onSelect` so the host can
 * make the strip tappable and an `isActive` flag for the active-card styling.
 *
 * Feature: map-discovery-experience
 * Validates: Requirements 1.2, 4.1, 4.6
 */
export interface VenueCardProps {
  vm: VenueCardVM
  /** Venue category - drives the glyph's contrast outline. */
  category: NodeCategory
  /** Marks this card as the Active_Venue's card for distinct styling. */
  isActive?: boolean
  /** Invoked when the card is activated (tap / click / keyboard). */
  onSelect?: () => void
}

const GLYPH_SIZE_PX = 28

export const VenueCard = memo(function VenueCard({ vm, category, isActive = false, onSelect }: VenueCardProps) {
  const { t } = useTranslation()
  const pulseColour = getPulseStateColour(vm.pulseState)

  // The numeric count is rendered directly in JSX (not via i18n interpolation)
  // so the live headcount is always present in the DOM; only the trailing
  // "here now" label is translated. When the count is zero the whole count is
  // replaced by the "be the first in" affordance (R4.6 / Property 2).
  const hereNowLabel = t('venueCard.hereNow', 'here now')
  const beFirstLabel = t('venueCard.beFirst', 'Be the first in')
  const countText = `${vm.liveCheckInCount} ${hereNowLabel}`

  return (
    <button
      type="button"
      onClick={onSelect}
      data-venue-card={vm.id}
      data-pulse-state={vm.pulseState}
      aria-pressed={isActive}
      aria-label={`${vm.name}, ${vm.isFirstIn ? beFirstLabel : countText}`}
      className={`glass-raised flex flex-col items-start gap-2 rounded-2xl px-4 py-3 text-left transition-all duration-150 active:scale-95 focus:outline-none focus-visible:border-[var(--accent)] ${
        isActive ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex flex-row items-center gap-2 w-full min-w-0">
        {/* Archetype glyph in the venue's Pulse_State colour (R1.2). The glyph
            positions itself absolutely against its parent, so it is wrapped in a
            relative-sized box. It is aria-hidden - the colour/state is conveyed
            textually through the count label and the parent aria-label. */}
        <div className="relative shrink-0" style={{ width: GLYPH_SIZE_PX, height: GLYPH_SIZE_PX }}>
          <ArchetypeGlyph
            archetypeId={vm.archetypeId}
            pulseState={vm.pulseState}
            category={category}
            size={GLYPH_SIZE_PX}
            silhouetteColour={pulseColour}
          />
        </div>
        <h3 className="text-[var(--text-primary)] font-semibold text-sm font-[Syne] truncate flex-1 min-w-0">
          {vm.name}
        </h3>
      </div>

      {vm.isFirstIn ? (
        <span className="text-[var(--text-secondary)] text-xs font-medium">{beFirstLabel}</span>
      ) : (
        <span className="text-xs font-medium" style={{ color: pulseColour }}>
          <span className="font-semibold">{vm.liveCheckInCount}</span> {hereNowLabel}
        </span>
      )}
    </button>
  )
})
