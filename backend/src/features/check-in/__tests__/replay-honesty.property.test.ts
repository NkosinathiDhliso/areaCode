/**
 * Feature: cross-portal-lifecycle-alignment, Property 3: Replay honesty.
 *
 * **Validates: Requirements 5.3, 5.4**
 *
 * Two clauses, both over the pure replay core (`check-in/replay.ts`) that the
 * service delegates to:
 *
 *   1. Acceptance implies freshness: `isWithinReplayWindow(capturedAt, now)` is
 *      true only when `now - capturedAt <= 15 minutes`. A malformed timestamp is
 *      never accepted.
 *   2. Presence never backdates: `replayPresenceStartMs(now, capturedAt)` equals
 *      `now` for ANY `capturedAt`, so a replayed check-in's presence window
 *      starts at delivery, never at capture (honest-presence).
 */

import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { isWithinReplayWindow, replayPresenceStartMs, REPLAY_WINDOW_MS } from '../replay.js'

const FIXED_NOW_MS = Date.UTC(2026, 5, 15, 12, 0, 0)

// An offset (ms) relative to now, spanning well before and after the window edge.
const offsetArb = fc.integer({ min: -60 * 60 * 1000, max: 60 * 60 * 1000 })

describe('Feature: cross-portal-lifecycle-alignment, Property 3: Replay honesty', () => {
  it('accepts a capturedAt iff it is no older than the Replay_Window (R5.3, R5.4)', () => {
    fc.assert(
      fc.property(offsetArb, (offsetMs) => {
        const capturedMs = FIXED_NOW_MS - offsetMs
        const capturedIso = new Date(capturedMs).toISOString()
        const accepted = isWithinReplayWindow(capturedIso, FIXED_NOW_MS)
        // age = now - captured = offsetMs. Accept iff age <= window.
        expect(accepted).toBe(offsetMs <= REPLAY_WINDOW_MS)
      }),
      { numRuns: 300 },
    )
  })

  it('never accepts a malformed capturedAt', () => {
    fc.assert(
      fc.property(fc.constantFrom('not-a-date', 'garbage', '2026-13-45', '', 'true'), (bad) => {
        expect(isWithinReplayWindow(bad, FIXED_NOW_MS)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('presence start equals now and never the capturedAt (honest-presence, R5.3)', () => {
    fc.assert(
      fc.property(offsetArb, (offsetMs) => {
        const capturedMs = FIXED_NOW_MS - offsetMs
        const capturedIso = new Date(capturedMs).toISOString()
        const start = replayPresenceStartMs(FIXED_NOW_MS, capturedIso)
        expect(start).toBe(FIXED_NOW_MS)
        // Only coincides with capturedAt when they are genuinely the same instant.
        if (offsetMs !== 0) expect(start).not.toBe(capturedMs)
      }),
      { numRuns: 300 },
    )
  })
})
