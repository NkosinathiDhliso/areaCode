// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VenueCardVM } from '../../lib/carouselConstants'
import { getPulseStateColour } from '../../lib/mapHelpers'
import { VenueCard } from '../VenueCard'

afterEach(cleanup)

// `useTranslation` falls back to the inline default value when no i18n
// resources are loaded in unit tests. The numeric count is rendered directly
// in JSX (not via i18n interpolation), so it is always present in the DOM.

function makeVM(overrides: Partial<VenueCardVM> = {}): VenueCardVM {
  return {
    id: 'node-1',
    name: 'The Test Venue',
    liveCheckInCount: 12,
    pulseState: 'buzzing',
    archetypeId: 'archetype-festival-spirit',
    isFirstIn: false,
    ...overrides,
  }
}

describe('VenueCard', () => {
  it('renders the venue name (R1.2)', () => {
    render(<VenueCard vm={makeVM()} category="nightlife" />)
    expect(screen.getByText('The Test Venue')).toBeTruthy()
  })

  it('displays the live check-in count when count is greater than zero (R1.2, R4.1)', () => {
    render(<VenueCard vm={makeVM({ liveCheckInCount: 12 })} category="nightlife" />)
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('here now')).toBeTruthy()
  })

  it('renders the "be the first in" affordance in place of a numeric count when count is zero (R4.6)', () => {
    render(
      <VenueCard vm={makeVM({ liveCheckInCount: 0, isFirstIn: true, pulseState: 'dormant' })} category="nightlife" />,
    )
    expect(screen.getByText('Be the first in')).toBeTruthy()
    // No "here now" count label is shown for an empty venue.
    expect(screen.queryByText('here now')).toBeNull()
  })

  it('renders the archetype glyph in the venue Pulse_State colour (R1.2)', () => {
    const { container } = render(<VenueCard vm={makeVM({ pulseState: 'buzzing' })} category="nightlife" />)
    const glyph = container.querySelector('[data-archetype-glyph="archetype-festival-spirit"]')
    expect(glyph).toBeTruthy()
    // The fill (silhouette) pass paints in the Pulse_State colour, so the
    // colour hex appears somewhere in the glyph's rendered subtree.
    const pulseColour = getPulseStateColour('buzzing')
    expect(glyph?.innerHTML.includes(pulseColour)).toBe(true)
  })

  it('invokes onSelect when activated', () => {
    const onSelect = vi.fn()
    render(<VenueCard vm={makeVM()} category="nightlife" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('marks the active card with aria-pressed', () => {
    render(<VenueCard vm={makeVM()} category="nightlife" isActive />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })
})
