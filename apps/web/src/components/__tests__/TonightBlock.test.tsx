// @vitest-environment jsdom
/**
 * `TonightBlock` on the consumer venue detail (proof-of-demand R8.7, R8.8, R8.9).
 *
 * What the block must get right:
 *  - headline, start time and featured get render regardless of the live-vibe
 *    flags (R8.9)
 *  - the heading under-claims: only a resolved `crowd_live` branch (the
 *    Presence_Floor decision) may describe the room now; everything else,
 *    including an unknown branch, reads as expected (R8.8)
 *  - nothing published renders no Tonight card, never a placeholder
 *  - the featured get opens the get's existing reward row rather than offering a
 *    second claim path
 *  - the Going control is always offered, and the count it names follows the
 *    Going_Threshold (R9.2)
 *
 * _Requirements: 8.7, 8.8, 8.9, 9.2_
 */

import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { VenueTonight } from '@area-code/shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The hosted Going control reads the viewer's own mark for a signed-in consumer.
// Nothing here is signed in, so nothing is read; the mock keeps it that way.
vi.mock('@area-code/shared/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

import { TonightBlock } from '../TonightBlock'

afterEach(cleanup)

const NODE_ID = 'node-1'

function tonight(overrides: Partial<VenueTonight> = {}): VenueTonight {
  return {
    headline: 'Amapiano all night',
    startsAt: '21:00',
    archetypeId: 'archetype-festival-spirit',
    ...overrides,
  }
}

beforeEach(() => {
  // Drive the real store rather than mocking the hook: the branch is the one
  // piece of live state the block reads.
  useMapStore.setState({ archetypeBranches: {} })
})

describe('TonightBlock content (R8.7, R8.9)', () => {
  it('renders the headline and the local start time', () => {
    render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} />)

    expect(screen.getByText('Amapiano all night')).toBeTruthy()
    expect(screen.getByText(/21:00/)).toBeTruthy()
  })

  it('omits the start time once the slot is running', () => {
    const { container } = render(<TonightBlock tonight={tonight({ startsAt: null })} nodeId={NODE_ID} />)

    expect(screen.getByText('Amapiano all night')).toBeTruthy()
    expect(container.querySelector('[data-tonight-starts]')).toBeNull()
  })

  it('renders no Tonight card when nothing is published', () => {
    const { container } = render(<TonightBlock tonight={null} nodeId={NODE_ID} />)

    expect(container.querySelector(`[data-tonight-block="${NODE_ID}"]`)).toBeNull()
    // No placeholder and no invented promise: the only thing left is the Going
    // control, which is offered whether or not the owner published a night.
    expect(container.textContent).not.toContain('Expected tonight')
    expect(container.textContent).not.toContain('In the room now')
  })

  // R9.2: the detail block always offers the Going control, and the "be the
  // first" prompt belongs to the block with a Tonight, never to a bare venue.
  it('offers the Going control with a Tonight and without one', () => {
    const { container: withTonight } = render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} />)
    expect(withTonight.querySelector(`[data-going-control="${NODE_ID}"]`)).toBeTruthy()
    cleanup()

    const { container: bare } = render(<TonightBlock tonight={null} nodeId={NODE_ID} />)
    expect(bare.querySelector(`[data-going-control="${NODE_ID}"]`)).toBeTruthy()
  })

  it('names no Going count below the threshold', () => {
    const { container } = render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} goingCount={2} />)

    expect(container.querySelector('[data-going-count]')).toBeNull()
  })

  it('names the Going count at the threshold', () => {
    const { container } = render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} goingCount={3} />)

    expect(container.querySelector('[data-going-count]')?.textContent).toContain('3')
  })
})

describe('TonightBlock heading, under-claim by default (R8.8)', () => {
  it('reads as expected when no branch has resolved', () => {
    render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} />)

    expect(screen.getByText('Expected tonight')).toBeTruthy()
    expect(screen.queryByText('In the room now')).toBeNull()
  })

  it('reads as expected below the Presence_Floor (declared_promise)', () => {
    useMapStore.setState({ archetypeBranches: { [NODE_ID]: 'declared_promise' } })
    render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} />)

    expect(screen.getByText('Expected tonight')).toBeTruthy()
  })

  it('describes the room only once the venue resolved to crowd_live', () => {
    useMapStore.setState({ archetypeBranches: { [NODE_ID]: 'crowd_live' } })
    render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} />)

    expect(screen.getByText('In the room now')).toBeTruthy()
    expect(screen.queryByText('Expected tonight')).toBeNull()
  })

  it('reads another venue\u2019s branch as its own business, not this one\u2019s', () => {
    useMapStore.setState({ archetypeBranches: { 'node-other': 'crowd_live' } })
    render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} />)

    expect(screen.getByText('Expected tonight')).toBeTruthy()
  })
})

describe('TonightBlock featured get (R8.7)', () => {
  const withGet = tonight({ rewardTitle: 'Free welcome drink', featuredRewardId: 'reward-1' })

  it('opens the get\u2019s existing reward row instead of claiming inline', () => {
    const onOpenFeaturedGet = vi.fn()
    const { container } = render(
      <TonightBlock tonight={withGet} nodeId={NODE_ID} onOpenFeaturedGet={onOpenFeaturedGet} />,
    )

    const control = container.querySelector('[data-tonight-get]') as HTMLButtonElement
    fireEvent.click(control)

    expect(onOpenFeaturedGet).toHaveBeenCalledTimes(1)
    // One claim path: the block points at the reward row, it does not post.
    expect(control.tagName).toBe('BUTTON')
  })

  it('gives the control a 44px touch target', () => {
    const { container } = render(<TonightBlock tonight={withGet} nodeId={NODE_ID} onOpenFeaturedGet={vi.fn()} />)

    expect(container.querySelector('[data-tonight-get]')?.className).toContain('min-h-11')
  })

  it('renders the title as text when the get is not on this venue\u2019s reward list', () => {
    const { container } = render(<TonightBlock tonight={withGet} nodeId={NODE_ID} />)

    const node = container.querySelector('[data-tonight-get]')
    // No control that would do nothing when tapped.
    expect(node?.tagName).toBe('SPAN')
    expect(node?.textContent).toBe('Free welcome drink')
  })

  it('renders no get row when the featured get is gone', () => {
    const { container } = render(<TonightBlock tonight={tonight()} nodeId={NODE_ID} onOpenFeaturedGet={vi.fn()} />)

    expect(container.querySelector('[data-tonight-get]')).toBeNull()
  })
})
