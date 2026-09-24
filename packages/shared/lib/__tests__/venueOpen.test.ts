/**
 * Venue_Open client (proof-of-demand task 2.5, R2.1, R2.2, R2.6, R11.1).
 *
 * The two claims an owner's receipt rests on, asserted at the wire:
 *
 *  - the request carries `{ source, away }` and nothing else, so no coordinate,
 *    no venue position and no device data can reach the stored row (R2.2, R11.1)
 *  - `away` is the distance arm of the Away_Gate: `distance > 500 m`, and `null`
 *    whenever the position is missing or stale, so an unknown position errs
 *    toward `walk_in` rather than inventing demand
 *
 * Plus the aggregate `venue_open` usage event (R2.6), which carries the source
 * and no venue id, and the promise that a failed open never throws at the
 * consumer who was only trying to look at a venue.
 *
 * The api client is mocked; nothing else is. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AWAY_DISTANCE_METRES } from '../../constants/attribution'
import { setAnalyticsOptIn, flushEvents, resetUsageBeaconForTest } from '../usageEvents'
import { computeAwayFlag, recordVenueOpen } from '../venueOpen'

const mocks = vi.hoisted(() => ({ post: vi.fn(async () => undefined) }))

vi.mock('../api', () => ({ api: { post: mocks.post, get: vi.fn() } }))

/** Rosebank, Johannesburg. */
const VENUE = { lat: -26.1467, lng: 28.0436 }
/** ~20 m north of VENUE: inside any check-in radius. */
const AT_THE_DOOR = { lat: -26.1465, lng: 28.0436 }
/** ~8 km away: unambiguously away. */
const ACROSS_TOWN = { lat: -26.2041, lng: 28.0473 }

beforeEach(() => {
  mocks.post.mockClear()
  resetUsageBeaconForTest()
})

afterEach(() => {
  resetUsageBeaconForTest()
})

describe('computeAwayFlag (R2.2)', () => {
  it('is true when a fresh position is further than the away distance', () => {
    expect(computeAwayFlag({ position: ACROSS_TOWN, positionFresh: true, venue: VENUE })).toBe(true)
  })

  it('is false when a fresh position is at the venue', () => {
    expect(computeAwayFlag({ position: AT_THE_DOOR, positionFresh: true, venue: VENUE })).toBe(false)
  })

  it('errs toward walk_in just inside the away distance and flips just outside it', () => {
    // The gate is the maximum check-in radius, so a consumer who could still
    // legitimately check in from where they stand is not away. Offsets are in
    // degrees of latitude on the same sphere the haversine uses.
    const metresPerDegreeLat = (6_371_000 * Math.PI) / 180
    const offset = (metres: number) => ({ lat: VENUE.lat + metres / metresPerDegreeLat, lng: VENUE.lng })

    expect(computeAwayFlag({ position: offset(AWAY_DISTANCE_METRES - 1), positionFresh: true, venue: VENUE })).toBe(
      false,
    )
    expect(computeAwayFlag({ position: offset(AWAY_DISTANCE_METRES + 1), positionFresh: true, venue: VENUE })).toBe(
      true,
    )
  })

  it('is null when the position is stale, absent, or not a finite coordinate', () => {
    expect(computeAwayFlag({ position: ACROSS_TOWN, positionFresh: false, venue: VENUE })).toBeNull()
    expect(computeAwayFlag({ position: null, positionFresh: true, venue: VENUE })).toBeNull()
    expect(computeAwayFlag({ position: undefined, positionFresh: true, venue: VENUE })).toBeNull()
    expect(computeAwayFlag({ position: { lat: Number.NaN, lng: 28 }, positionFresh: true, venue: VENUE })).toBeNull()
  })
})

describe('recordVenueOpen (R2.1, R2.2, R11.1)', () => {
  it('posts the open to the venue route with exactly { source, away }', async () => {
    await recordVenueOpen('node-1', 'share', true)

    expect(mocks.post).toHaveBeenCalledTimes(1)
    const [path, body] = mocks.post.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(path).toBe('/v1/nodes/node-1/open')
    expect(body).toEqual({ source: 'share', away: true })
    expect(Object.keys(body).sort()).toEqual(['away', 'source'])
  })

  it('sends the unknown away flag as null rather than omitting or guessing it', async () => {
    await recordVenueOpen('node-1', 'map', null)

    const [, body] = mocks.post.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(body).toEqual({ source: 'map', away: null })
  })

  it('leaks no coordinates anywhere in the serialised request', async () => {
    await recordVenueOpen('node-1', 'push', false)

    const [path, body] = mocks.post.mock.calls[0] as unknown as [string, unknown]
    const wire = `${path} ${JSON.stringify(body)}`
    for (const forbidden of ['lat', 'lng', 'accuracy', 'position', 'coords']) {
      expect(wire).not.toContain(forbidden)
    }
  })

  it('percent-encodes the node id into the path', async () => {
    await recordVenueOpen('node/../admin', 'map', null)

    const [path] = mocks.post.mock.calls[0] as unknown as [string]
    expect(path).toBe('/v1/nodes/node%2F..%2Fadmin/open')
  })

  it('never throws when the request fails: a lost open reads as a walk-in', async () => {
    mocks.post.mockRejectedValueOnce({ statusCode: 429, error: 'rate_limited', message: 'slow down' })

    await expect(recordVenueOpen('node-1', 'map', null)).resolves.toBeUndefined()
  })
})

describe('venue_open usage event (R2.6)', () => {
  it('emits the aggregate event with the source and no venue id', async () => {
    setAnalyticsOptIn(true)

    await recordVenueOpen('node-1', 'share', true)
    await flushEvents()

    const batch = mocks.post.mock.calls.find((c) => c[0] === '/v1/events')
    expect(batch).toBeDefined()
    const { events } = batch![1] as { events: Array<{ name: string; props?: Record<string, unknown> }> }
    const open = events.find((e) => e.name === 'venue_open')
    expect(open?.props).toEqual({ source: 'share' })
    expect(JSON.stringify(events)).not.toContain('node-1')
  })

  it('emits nothing when the consumer has not opted in', async () => {
    await recordVenueOpen('node-1', 'share', true)
    await flushEvents()

    expect(mocks.post.mock.calls.some((c) => c[0] === '/v1/events')).toBe(false)
  })
})
