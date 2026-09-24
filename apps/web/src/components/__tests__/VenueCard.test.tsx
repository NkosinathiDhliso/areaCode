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

// ─── Tonight line (proof-of-demand R8.6) ─────────────────────────────────────

/**
 * Tonight is an anticipation magnet that sits ALONGSIDE the aliveness and taste
 * signals. The binding rule is that it never replaces or outranks them
 * (`discovery-dna-vibe-over-convenience.md`), and that a venue with nothing
 * published renders nothing rather than a placeholder (`honest-presence.md`).
 */
describe('VenueCard Tonight line (R8.6)', () => {
  const tonight = {
    headline: 'Amapiano all night',
    startsAt: '21:00',
    archetypeId: 'archetype-festival-spirit',
  }

  it('renders one line with the headline and the local start time', () => {
    const { container } = render(<VenueCard vm={makeVM({ tonight })} category="nightlife" />)

    const line = container.querySelector('[data-venue-card-tonight="node-1"]')
    expect(line).toBeTruthy()
    expect(line?.textContent).toContain('Amapiano all night')
    expect(line?.textContent).toContain('from 21:00')
  })

  it('drops the start time once the slot is running', () => {
    const { container } = render(
      <VenueCard vm={makeVM({ tonight: { ...tonight, startsAt: null } })} category="nightlife" />,
    )

    const line = container.querySelector('[data-venue-card-tonight="node-1"]')
    expect(line?.textContent).toContain('Amapiano all night')
    expect(line?.textContent).not.toContain('from')
  })

  it('includes the featured get when one is live', () => {
    const { container } = render(
      <VenueCard vm={makeVM({ tonight: { ...tonight, rewardTitle: 'Free welcome drink' } })} category="nightlife" />,
    )

    expect(container.querySelector('[data-venue-card-tonight="node-1"]')?.textContent).toContain('Free welcome drink')
  })

  it('renders nothing when no Tonight is published', () => {
    const { container } = render(<VenueCard vm={makeVM({ tonight: null })} category="nightlife" />)

    expect(container.querySelector('[data-venue-card-tonight="node-1"]')).toBeNull()
  })

  it('never replaces the pulse line or the taste glyph', () => {
    const { container } = render(<VenueCard vm={makeVM({ liveCheckInCount: 12, tonight })} category="nightlife" />)

    // Aliveness and taste both still render.
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('here now')).toBeTruthy()
    expect(container.querySelector('[data-archetype-glyph="archetype-festival-spirit"]')).toBeTruthy()
  })

  it('keeps aliveness ahead of Tonight in the DOM and in the accessible name', () => {
    const { container } = render(<VenueCard vm={makeVM({ liveCheckInCount: 12, tonight })} category="nightlife" />)

    const card = container.querySelector('[data-venue-card="node-1"]')!
    const tonightLine = container.querySelector('[data-venue-card-tonight="node-1"]')!
    const countLine = screen.getByText('here now')
    // The pulse row precedes the Tonight line, so the card reads alive-first.
    expect(countLine.compareDocumentPosition(tonightLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const label = card.getAttribute('aria-label') ?? ''
    expect(label.indexOf('12 here now')).toBeLessThan(label.indexOf('Amapiano all night'))
  })

  it('renders the "be the first in" affordance alongside Tonight, not instead of it', () => {
    // The magnet that works on an empty map: an honest empty room plus a real
    // reason to come tonight.
    const { container } = render(
      <VenueCard
        vm={makeVM({ liveCheckInCount: 0, isFirstIn: true, pulseState: 'dormant', tonight })}
        category="nightlife"
      />,
    )

    expect(screen.getByText('Be the first in')).toBeTruthy()
    expect(container.querySelector('[data-venue-card-tonight="node-1"]')).toBeTruthy()
  })
})

// ─── Going line (proof-of-demand R9.2, R9.3) ─────────────────────────────────

/**
 * Going is intent, not presence. The card may name it only at or above the
 * Going_Threshold and only when a Tonight is published; below that it says
 * nothing about Going at all and never gains a second "be the first" line
 * (R9.2). It sits outside the pulse row so it can never be read as a headcount
 * (`honest-presence.md`).
 */
describe('VenueCard Going line (R9.2, R9.3)', () => {
  const tonight = {
    headline: 'Amapiano all night',
    startsAt: '21:00',
    archetypeId: 'archetype-festival-spirit',
  }

  it('names the count at the threshold with a Tonight published', () => {
    const { container } = render(<VenueCard vm={makeVM({ tonight, goingCount: 3 })} category="nightlife" />)

    const line = container.querySelector('[data-venue-card-going="node-1"]')
    expect(line?.textContent).toBe('3 marked going tonight')
  })

  it('says nothing below the threshold', () => {
    const { container } = render(<VenueCard vm={makeVM({ tonight, goingCount: 2 })} category="nightlife" />)

    expect(container.querySelector('[data-venue-card-going="node-1"]')).toBeNull()
    expect(container.textContent).not.toContain('going')
  })

  it('says nothing without a Tonight, however many marked', () => {
    const { container } = render(<VenueCard vm={makeVM({ tonight: null, goingCount: 40 })} category="nightlife" />)

    expect(container.querySelector('[data-venue-card-going="node-1"]')).toBeNull()
  })

  it('says nothing for a count nobody measured', () => {
    const { container } = render(<VenueCard vm={makeVM({ tonight, goingCount: null })} category="nightlife" />)

    expect(container.querySelector('[data-venue-card-going="node-1"]')).toBeNull()
  })

  it('never gains a second "be the first" line', () => {
    const { container } = render(
      <VenueCard
        vm={makeVM({ liveCheckInCount: 0, isFirstIn: true, pulseState: 'dormant', tonight, goingCount: 0 })}
        category="nightlife"
      />,
    )

    // One "be the first in" only, and it is the presence affordance.
    expect(screen.getAllByText(/Be the first/)).toHaveLength(1)
    expect(container.querySelector('[data-venue-card-going="node-1"]')).toBeNull()
  })

  it('keeps Going out of the pulse row and behind aliveness', () => {
    const { container } = render(
      <VenueCard vm={makeVM({ liveCheckInCount: 12, tonight, goingCount: 5 })} category="nightlife" />,
    )

    const goingLine = container.querySelector('[data-venue-card-going="node-1"]')!
    const countLine = screen.getByText('here now')
    // The live count is a different element, and it comes first.
    expect(goingLine.contains(countLine)).toBe(false)
    expect(countLine.compareDocumentPosition(goingLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 12 here now, 5 marked going: the two numbers never merge.
    expect(goingLine.textContent).toBe('5 marked going tonight')
  })
})
