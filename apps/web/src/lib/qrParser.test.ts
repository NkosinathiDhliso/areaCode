import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { parseVenueQr } from './qrParser'

/**
 * Map Discovery — venue QR parsing property tests (deferred tasks 4.4, 4.5).
 *
 *   - Property 20: Valid venue QR round-trips to a check-in
 *   - Property 21: Invalid QR is rejected without check-in
 *
 * Validates: Requirements 14.5, 14.6
 */

// A path segment that never contains a separator (/), query (?), or fragment (#)
// marker, nor whitespace — so the round-trip is unambiguous.
const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~'.split('')
const segArb = fc.array(fc.constantFrom(...SAFE_CHARS), { minLength: 1, maxLength: 12 }).map((a) => a.join(''))
const hostArb = fc.constantFrom('https://areacode.co.za', 'http://localhost:3000', 'https://www.areacode.co.za', '')

describe('Feature: map-discovery-experience, Property 20: Valid venue QR round-trips to a check-in', () => {
  it('extracts { nodeId, token } from any /qr/{nodeId}/{token} URL or bare path', () => {
    fc.assert(
      fc.property(segArb, segArb, hostArb, (nodeId, token, host) => {
        expect(parseVenueQr(`${host}/qr/${nodeId}/${token}`)).toEqual({ nodeId, token })
      }),
    )
  })

  it('tolerates a trailing slash, query string, and fragment after the token', () => {
    fc.assert(
      fc.property(segArb, segArb, (nodeId, token) => {
        expect(parseVenueQr(`/qr/${nodeId}/${token}/`)).toEqual({ nodeId, token })
        expect(parseVenueQr(`/qr/${nodeId}/${token}?utm=x`)).toEqual({ nodeId, token })
        expect(parseVenueQr(`/qr/${nodeId}/${token}#frag`)).toEqual({ nodeId, token })
        expect(parseVenueQr(`  /qr/${nodeId}/${token}  `)).toEqual({ nodeId, token })
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 21: Invalid QR is rejected without check-in', () => {
  it('returns null for any string without a /qr/{id}/{token} tail', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        fc.pre(!/\/qr\/[^/?#]+\/[^/?#]+/.test(s))
        expect(parseVenueQr(s)).toBeNull()
      }),
    )
  })

  it('rejects missing or empty segments', () => {
    fc.assert(
      fc.property(segArb, (seg) => {
        expect(parseVenueQr(`/qr/${seg}`)).toBeNull() // no token segment
        expect(parseVenueQr(`/qr//${seg}`)).toBeNull() // empty nodeId
        expect(parseVenueQr(`/qr/${seg}/`)).toBeNull() // empty token
        expect(parseVenueQr('/qr/')).toBeNull()
        expect(parseVenueQr('')).toBeNull()
      }),
    )
  })
})
