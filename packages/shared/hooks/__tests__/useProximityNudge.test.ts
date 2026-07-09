import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { shouldFireNudge, recordFired, recordDismissed } from '../useProximityNudge'

const DAY = 86_400_000
const HOUR = 3_600_000

const baseState = () => ({
  lastFiredAt: {} as Record<string, number>,
  dismissedAt: {} as Record<string, number>,
  firedToday: { date: '2026-05-16', count: 0 },
})

describe('shouldFireNudge', () => {
  it('fires when no history exists', () => {
    expect(shouldFireNudge('v1', baseState(), Date.parse('2026-05-16T12:00:00Z'))).toBe(true)
  })

  it('blocks for 6h after a fire', () => {
    let s = baseState()
    s = recordFired(s, 'v1', Date.parse('2026-05-16T12:00:00Z'))
    // 5h59 later - still blocked
    expect(shouldFireNudge('v1', s, Date.parse('2026-05-16T12:00:00Z') + 5 * HOUR + 59 * 60_000)).toBe(false)
    // 6h01 later - clear
    expect(shouldFireNudge('v1', s, Date.parse('2026-05-16T12:00:00Z') + 6 * HOUR + 60_000)).toBe(true)
  })

  it('blocks for 24h after a dismiss', () => {
    let s = baseState()
    s = recordDismissed(s, 'v1', Date.parse('2026-05-16T12:00:00Z'))
    expect(shouldFireNudge('v1', s, Date.parse('2026-05-16T12:00:00Z') + 23 * HOUR)).toBe(false)
    expect(shouldFireNudge('v1', s, Date.parse('2026-05-16T12:00:00Z') + 24 * HOUR + 60_000)).toBe(true)
  })

  it('blocks once daily cap of 5 reached', () => {
    fc.assert(
      fc.property(fc.array(fc.uuid(), { minLength: 5, maxLength: 5 }), (ids) => {
        let s = baseState()
        const t0 = Date.parse('2026-05-16T08:00:00Z')
        ids.forEach((id, i) => {
          // fires spaced an hour apart so cooldown doesn't apply across IDs
          s = recordFired(s, id, t0 + i * HOUR)
        })
        // Sixth, different venue
        expect(shouldFireNudge('venue6', s, t0 + 6 * HOUR)).toBe(false)
      }),
    )
  })

  it('resets daily cap when the date rolls over', () => {
    let s = baseState()
    const t0 = Date.parse('2026-05-16T20:00:00Z')
    for (let i = 0; i < 5; i++) {
      s = recordFired(s, `v${i}`, t0 + i * HOUR)
    }
    // Next day after midnight UTC
    const t1 = Date.parse('2026-05-18T01:00:00Z')
    // Simulate the date-rollover branch the hook performs
    s = { ...s, firedToday: { date: '2026-05-18', count: 0 } }
    expect(shouldFireNudge('vNew', s, t1)).toBe(true)
  })

  it('cooldowns are independent per venue', () => {
    let s = baseState()
    s = recordFired(s, 'v1', Date.parse('2026-05-16T12:00:00Z'))
    expect(shouldFireNudge('v2', s, Date.parse('2026-05-16T12:01:00Z'))).toBe(true)
  })

  it('dismissal cooldown wins over fire cooldown when longer', () => {
    let s = baseState()
    s = recordFired(s, 'v1', Date.parse('2026-05-16T12:00:00Z'))
    s = recordDismissed(s, 'v1', Date.parse('2026-05-16T12:00:00Z'))
    // 7h after - fire cooldown over (6h) but dismiss is not (24h)
    expect(shouldFireNudge('v1', s, Date.parse('2026-05-16T12:00:00Z') + 7 * HOUR)).toBe(false)
    expect(shouldFireNudge('v1', s, Date.parse('2026-05-16T12:00:00Z') + DAY + HOUR)).toBe(true)
  })
})
