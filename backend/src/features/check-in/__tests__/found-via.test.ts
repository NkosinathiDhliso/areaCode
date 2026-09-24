/**
 * Example-based coverage for the Away_Gate boundaries (proof-of-demand R2.3,
 * R2.4). The exact instants that decide Found_You from Walk_In are pinned here:
 * one millisecond either side of the time arm and of the Attribution_Window.
 * The universal rules are Property 1 and live in the property test.
 */

import { ATTRIBUTION_WINDOW_HOURS, AWAY_GATE_MIN_MINUTES } from '@area-code/shared/constants/attribution'
import { describe, expect, it } from 'vitest'

import { resolveFoundVia, type VenueOpenRow } from '../found-via.js'

const MINUTE_MS = 60_000
const GATE_MS = AWAY_GATE_MIN_MINUTES * MINUTE_MS
const WINDOW_MS = ATTRIBUTION_WINDOW_HOURS * 60 * MINUTE_MS

/** A Friday night check-in, 21:30 SAST. */
const CHECK_IN_AT = Date.parse('2026-10-02T19:30:00.000Z')
const CHECK_IN_ISO = new Date(CHECK_IN_AT).toISOString()

function openedAgo(ageMs: number, away: boolean | null): VenueOpenRow {
  return { source: 'map', openedAt: new Date(CHECK_IN_AT - ageMs).toISOString(), away }
}

describe('resolveFoundVia — the time arm boundary', () => {
  it('credits the source at exactly the gate with the position unknown', () => {
    expect(resolveFoundVia(openedAgo(GATE_MS, null), CHECK_IN_ISO)).toBe('map')
  })

  it('reads one millisecond short of the gate as a walk-in', () => {
    expect(resolveFoundVia(openedAgo(GATE_MS - 1, null), CHECK_IN_ISO)).toBe('walk_in')
  })

  it('reads one millisecond short of the gate as a walk-in when the consumer was inside the radius', () => {
    expect(resolveFoundVia(openedAgo(GATE_MS - 1, false), CHECK_IN_ISO)).toBe('walk_in')
  })

  it('credits the source short of the gate when the consumer was away', () => {
    expect(resolveFoundVia(openedAgo(GATE_MS - 1, true), CHECK_IN_ISO)).toBe('map')
  })

  it('reads a simultaneous open as a walk-in with the position unknown', () => {
    expect(resolveFoundVia(openedAgo(0, null), CHECK_IN_ISO)).toBe('walk_in')
  })
})

describe('resolveFoundVia — the Attribution_Window boundary', () => {
  it('credits the source at exactly the window', () => {
    expect(resolveFoundVia(openedAgo(WINDOW_MS, null), CHECK_IN_ISO)).toBe('map')
  })

  it('reads one millisecond past the window as a walk-in, even for an away open', () => {
    expect(resolveFoundVia(openedAgo(WINDOW_MS + 1, true), CHECK_IN_ISO)).toBe('walk_in')
  })

  it('reads an open recorded after the check-in as a walk-in', () => {
    expect(resolveFoundVia(openedAgo(-MINUTE_MS, true), CHECK_IN_ISO)).toBe('walk_in')
  })
})

describe('resolveFoundVia — rows it refuses to trust', () => {
  it('reads a missing row as a walk-in', () => {
    expect(resolveFoundVia(null, CHECK_IN_ISO)).toBe('walk_in')
  })

  it('reads a row whose source is not an Open_Source as a walk-in', () => {
    const row = { ...openedAgo(WINDOW_MS / 2, true), source: 'billboard' } as unknown as VenueOpenRow

    expect(resolveFoundVia(row, CHECK_IN_ISO)).toBe('walk_in')
  })

  it('reads a row claiming walk_in as its source as a walk-in', () => {
    const row = { ...openedAgo(WINDOW_MS / 2, true), source: 'walk_in' } as unknown as VenueOpenRow

    expect(resolveFoundVia(row, CHECK_IN_ISO)).toBe('walk_in')
  })
})

describe('resolveFoundVia — every source is carried through', () => {
  it('returns share, search and push unchanged when the gate passes', () => {
    const ageMs = GATE_MS + MINUTE_MS

    for (const source of ['share', 'search', 'push'] as const) {
      const row: VenueOpenRow = { source, openedAt: new Date(CHECK_IN_AT - ageMs).toISOString(), away: null }

      expect(resolveFoundVia(row, CHECK_IN_ISO)).toBe(source)
    }
  })

  it('reads an offline replay whose open expired while the phone was dark as a walk-in', () => {
    // `checkInInstant` is `capturedAt` for a replay: the row was valid when the
    // scan happened, so the age is measured from the capture, not from the sync.
    const capturedAt = new Date(CHECK_IN_AT).toISOString()
    const syncedAt = new Date(CHECK_IN_AT + WINDOW_MS + MINUTE_MS).toISOString()
    const row = openedAgo(GATE_MS, null)

    expect(resolveFoundVia(row, capturedAt)).toBe('map')
    expect(resolveFoundVia(row, syncedAt)).toBe('walk_in')
  })
})
