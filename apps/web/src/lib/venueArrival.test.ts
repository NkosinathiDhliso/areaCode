// @vitest-environment jsdom
/**
 * Tests for the venue deep-link arrival stash (proof-of-demand task 1.6,
 * R1.1, R1.5, R1.7, R12.3).
 *
 * Covers both URL shapes (`/node/{slug}` and `/map?venue={slug}&src=…`), the
 * source default and validation, the sessionStorage round trip that survives a
 * login redirect, and the address-bar normalisation that stops a back/forward
 * from replaying the arrival. jsdom for `window.location`, `history` and
 * `sessionStorage`; no network.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { pathToRoute } from '../App'

import {
  PENDING_VENUE_ARRIVAL_KEY,
  captureVenueArrivalFromLocation,
  clearVenueArrival,
  hasPendingVenueArrival,
  parseVenueArrival,
  readVenueArrival,
  stashVenueArrival,
} from './venueArrival'

/** Point jsdom at a URL without a full navigation. */
function setUrl(url: string): void {
  window.history.replaceState({}, '', url)
}

beforeEach(() => {
  sessionStorage.clear()
  setUrl('/')
})

describe('parseVenueArrival', () => {
  it('reads the slug and source from the shared link shape', () => {
    expect(parseVenueArrival('/node/great-dane', '')).toEqual({ slug: 'great-dane', source: 'share' })
  })

  it('reads the slug and source from the map query shape', () => {
    expect(parseVenueArrival('/map', '?venue=great-dane&src=share')).toEqual({
      slug: 'great-dane',
      source: 'share',
    })
  })

  it('keeps a push source', () => {
    expect(parseVenueArrival('/map', '?venue=great-dane&src=push')).toEqual({
      slug: 'great-dane',
      source: 'push',
    })
  })

  it('defaults an absent or unknown source to share, never map', () => {
    expect(parseVenueArrival('/node/great-dane', '')?.source).toBe('share')
    expect(parseVenueArrival('/map', '?venue=great-dane&src=walk_in')?.source).toBe('share')
    expect(parseVenueArrival('/map', '?venue=great-dane&src=nonsense')?.source).toBe('share')
  })

  it('returns null for every other URL and for an unusable slug', () => {
    expect(parseVenueArrival('/map', '')).toBeNull()
    expect(parseVenueArrival('/map', '?venue=')).toBeNull()
    expect(parseVenueArrival('/ranks', '?venue=great-dane')).toBeNull()
    expect(parseVenueArrival('/node/', '')).toBeNull()
    expect(parseVenueArrival('/node/not a slug', '')).toBeNull()
    expect(parseVenueArrival('/node/../etc', '')).toBeNull()
  })
})

describe('pathToRoute', () => {
  it('routes both venue deep-link shapes to the map', () => {
    expect(pathToRoute('/node/great-dane')).toBe('map')
    expect(pathToRoute('/node/great-dane/')).toBe('map')
    expect(pathToRoute('/map')).toBe('map')
  })

  it('leaves unrelated paths alone', () => {
    expect(pathToRoute('/node')).toBe('landing')
    expect(pathToRoute('/ranks')).toBe('ranks')
    expect(pathToRoute('/login')).toBe('login')
  })
})

describe('the stash', () => {
  it('round trips through sessionStorage so a login redirect keeps the source', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'push' })
    expect(hasPendingVenueArrival()).toBe(true)
    expect(readVenueArrival()).toEqual({ slug: 'great-dane', source: 'push' })
  })

  it('reads as empty once cleared', () => {
    stashVenueArrival({ slug: 'great-dane', source: 'share' })
    clearVenueArrival()
    expect(readVenueArrival()).toBeNull()
    expect(hasPendingVenueArrival()).toBe(false)
  })

  it('ignores a corrupt or invalid stash instead of throwing', () => {
    sessionStorage.setItem(PENDING_VENUE_ARRIVAL_KEY, 'not json')
    expect(readVenueArrival()).toBeNull()
    sessionStorage.setItem(PENDING_VENUE_ARRIVAL_KEY, JSON.stringify({ slug: 'not a slug', source: 'share' }))
    expect(readVenueArrival()).toBeNull()
  })
})

describe('captureVenueArrivalFromLocation', () => {
  it('stashes the arrival from a shared link and normalises the address bar', () => {
    setUrl('/node/great-dane')
    expect(captureVenueArrivalFromLocation()).toEqual({ slug: 'great-dane', source: 'share' })
    expect(readVenueArrival()).toEqual({ slug: 'great-dane', source: 'share' })
    expect(window.location.pathname).toBe('/map')
    expect(window.location.search).toBe('')
  })

  it('stashes the arrival from the map query shape and drops the query', () => {
    setUrl('/map?venue=great-dane&src=push')
    expect(captureVenueArrivalFromLocation()).toEqual({ slug: 'great-dane', source: 'push' })
    expect(readVenueArrival()).toEqual({ slug: 'great-dane', source: 'push' })
    expect(window.location.pathname).toBe('/map')
    expect(window.location.search).toBe('')
  })

  it('leaves a non-arrival URL untouched', () => {
    setUrl('/ranks')
    expect(captureVenueArrivalFromLocation()).toBeNull()
    expect(hasPendingVenueArrival()).toBe(false)
    expect(window.location.pathname).toBe('/ranks')
  })
})
