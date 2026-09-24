/**
 * Consumer-web Venue_Open wiring (proof-of-demand task 2.5, R2.1, R2.2).
 *
 * `reportVenueOpen` is the only place the web app turns an open into a recorded
 * Venue_Open. These tests drive the real location store and assert what actually
 * crosses the wire, because that is where the privacy promise lives: the device
 * position decides `away`, and only the boolean is sent.
 *
 * Freshness matters as much as distance. A stale fix could claim a consumer was
 * across town when they are standing at the bar, so an aged position must read
 * as unknown, not as away.
 *
 * The api client is mocked. No network.
 */
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POSITION_FRESHNESS_WINDOW } from './carouselConstants'
import { reportVenueOpen } from './venueOpen'

const mocks = vi.hoisted(() => ({ post: vi.fn(async () => undefined) }))

vi.mock('@area-code/shared/lib/api', () => ({ api: { post: mocks.post, get: vi.fn() } }))

/** Rosebank. */
const VENUE = { id: 'node-1', lat: -26.1467, lng: 28.0436 }
const AT_THE_DOOR = { lat: -26.1465, lng: 28.0436 }
const ACROSS_TOWN = { lat: -26.2041, lng: 28.0473 }

/** The body of the single recorded open. */
function postedBody(): Record<string, unknown> {
  expect(mocks.post).toHaveBeenCalledTimes(1)
  const [, body] = mocks.post.mock.calls[0] as unknown as [string, Record<string, unknown>]
  return body
}

function setPosition(pos: { lat: number; lng: number }, ageMs = 0): void {
  useLocationStore.setState({ lastKnownPosition: pos, capturedAt: Date.now() - ageMs, accuracy: 10 })
}

beforeEach(() => {
  mocks.post.mockClear()
  useLocationStore.setState({ lastKnownPosition: null, capturedAt: null, accuracy: null })
})

describe('reportVenueOpen', () => {
  it('records away=true from a fresh position far from the venue', () => {
    setPosition(ACROSS_TOWN)

    reportVenueOpen(VENUE, 'share')

    expect(postedBody()).toEqual({ source: 'share', away: true })
  })

  it('records away=false from a fresh position at the venue', () => {
    setPosition(AT_THE_DOOR)

    reportVenueOpen(VENUE, 'map')

    expect(postedBody()).toEqual({ source: 'map', away: false })
  })

  it('records away=null when the fix has aged out of the freshness window', () => {
    setPosition(ACROSS_TOWN, POSITION_FRESHNESS_WINDOW + 1_000)

    reportVenueOpen(VENUE, 'push')

    expect(postedBody()).toEqual({ source: 'push', away: null })
  })

  it('records away=null when no position was ever captured', () => {
    reportVenueOpen(VENUE, 'search')

    expect(postedBody()).toEqual({ source: 'search', away: null })
  })

  it('sends no coordinates, for the venue or the consumer (R2.2)', () => {
    setPosition(ACROSS_TOWN)

    reportVenueOpen(VENUE, 'map')

    const wire = JSON.stringify(postedBody())
    expect(wire).not.toContain(String(ACROSS_TOWN.lat))
    expect(wire).not.toContain(String(VENUE.lat))
    expect(wire).not.toContain('lat')
    expect(wire).not.toContain('lng')
  })

  it('posts to the venue open route', () => {
    reportVenueOpen(VENUE, 'map')

    const [path] = mocks.post.mock.calls[0] as unknown as [string]
    expect(path).toBe('/v1/nodes/node-1/open')
  })
})
