/**
 * Venue deep-link shape (proof-of-demand task 2.6, R1.1, R2.1, R12.3).
 *
 * `/map?venue={slug}&src={source}` is the one arrival URL, and the consumer app
 * parses it into a stashed `{ slug, source }` that becomes the Venue_Open. These
 * tests pin the exact string, because a drift here is silent: the link would
 * still open the app, the venue and the source would just vanish, and every
 * push-sourced Found_You would quietly read as a Walk_In.
 *
 * `pushVenueUrl` is the fragment every notification producer spreads into its
 * `data`, read back by the service worker on `notificationclick`.
 */
import { describe, expect, it } from 'vitest'

import { pushVenueUrl, venueArrivalPath } from '../venue-arrival.js'

describe('venueArrivalPath', () => {
  it('builds the arrival path with the venue and the source', () => {
    expect(venueArrivalPath('father-coffee-9z8y7x', 'share')).toBe('/map?venue=father-coffee-9z8y7x&src=share')
    expect(venueArrivalPath('father-coffee-9z8y7x', 'push')).toBe('/map?venue=father-coffee-9z8y7x&src=push')
  })

  it('encodes the slug so it cannot smuggle extra query parameters', () => {
    expect(venueArrivalPath('a&src=share', 'push')).toBe('/map?venue=a%26src%3Dshare&src=push')
  })
})

describe('pushVenueUrl (R2.1)', () => {
  it('carries the push-sourced venue link for a notification click-through', () => {
    expect(pushVenueUrl('great-dane-1a2b3c')).toEqual({ url: '/map?venue=great-dane-1a2b3c&src=push' })
  })

  it('always marks the source as push, never as share or map', () => {
    const { url } = pushVenueUrl('great-dane-1a2b3c')
    expect(url).toContain('src=push')
    expect(url).not.toContain('src=share')
  })

  it('omits the key entirely when there is no venue to link to', () => {
    expect(pushVenueUrl(null)).toEqual({})
    expect(pushVenueUrl(undefined)).toEqual({})
    expect(pushVenueUrl('   ')).toEqual({})
  })

  it('spreads into a notification data object without disturbing it', () => {
    expect({ nodeId: 'n1', ...pushVenueUrl('great-dane-1a2b3c') }).toEqual({
      nodeId: 'n1',
      url: '/map?venue=great-dane-1a2b3c&src=push',
    })
    expect({ nodeId: 'n1', ...pushVenueUrl(null) }).toEqual({ nodeId: 'n1' })
  })
})
