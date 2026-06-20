import type { GeoStatus } from '@area-code/shared/stores/locationStore'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { CTA_LABEL, getCtaInfo } from './checkInCta'

/**
 * Map Discovery — check-in CTA contract property test (deferred task 4.2).
 *
 *   - Property 15: Check-in CTA label is a function of Geo_Status
 *
 * Validates: Requirements 10.6, 10.7, 14.1
 */

const GEO_STATUSES: GeoStatus[] = ['idle', 'requesting', 'acquired', 'poorAccuracy', 'timeout', 'denied']

const inputArb = fc.record({
  geoStatus: fc.constantFrom(...GEO_STATUSES),
  qrFallback: fc.boolean(),
  pending: fc.boolean(),
})

describe('Feature: map-discovery-experience, Property 15: Check-in CTA label is a function of Geo_Status', () => {
  it('is deterministic — identical inputs yield identical output', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(getCtaInfo(input)).toEqual(getCtaInfo(input))
      }),
    )
  })

  it('honours the documented precedence (pending > qrFallback > geoStatus) and contract', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const info = getCtaInfo(input)
        if (input.pending) {
          expect(info).toEqual({ label: CTA_LABEL.checking, disabled: true })
          return
        }
        if (input.qrFallback) {
          expect(info).toEqual({ label: CTA_LABEL.scanQr, disabled: false })
          return
        }
        switch (input.geoStatus) {
          case 'requesting':
            expect(info).toEqual({ label: CTA_LABEL.locating, disabled: true })
            break
          case 'denied':
            expect(info).toEqual({ label: CTA_LABEL.button, disabled: true })
            break
          case 'poorAccuracy':
            expect(info).toEqual({ label: CTA_LABEL.weakSignal, disabled: false })
            break
          case 'timeout':
            expect(info).toEqual({ label: CTA_LABEL.locationUnavailable, disabled: false })
            break
          default:
            // acquired / idle → ready.
            expect(info).toEqual({ label: CTA_LABEL.button, disabled: false })
        }
      }),
    )
  })

  it('a pending request always disables the CTA, whatever the geo/QR state', () => {
    fc.assert(
      fc.property(fc.constantFrom(...GEO_STATUSES), fc.boolean(), (geoStatus, qrFallback) => {
        expect(getCtaInfo({ geoStatus, qrFallback, pending: true }).disabled).toBe(true)
      }),
    )
  })
})
