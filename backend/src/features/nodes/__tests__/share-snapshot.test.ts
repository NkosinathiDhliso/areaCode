/**
 * Example-based coverage for the Share_Preview snapshot line (proof-of-demand
 * R1.2, R1.3). The exact wording of the three lines in the design is pinned
 * here; the universal rules (never busy at zero presence, name always present,
 * length bound) are Property 4 and live in the property test.
 */

import { describe, expect, it } from 'vitest'

import { buildShareSnapshot } from '../share-snapshot.js'

const DOT = '\u00b7'

describe('buildShareSnapshot — the design examples', () => {
  it('renders pulse label, live count, Tonight and the get count', () => {
    const line = buildShareSnapshot({
      name: "Ramona's",
      pulseScore: 45,
      liveCheckInCount: 12,
      activeRewardCount: 1,
      tonight: { headline: 'Amapiano', startsAt: '21:00' },
    })

    expect(line).toBe(`Ramona's ${DOT} Buzzing ${DOT} 12 here now ${DOT} Amapiano tonight from 21:00 ${DOT} 1 get live`)
  })

  it('reads quiet with residual pulse and nobody there, keeping Tonight', () => {
    const line = buildShareSnapshot({
      name: "Ramona's",
      pulseScore: 8,
      liveCheckInCount: 0,
      activeRewardCount: 0,
      tonight: { headline: 'Amapiano', startsAt: '21:00' },
    })

    expect(line).toBe(`Ramona's ${DOT} Quiet right now ${DOT} Amapiano tonight from 21:00`)
  })

  it('invites the first in when there is no presence and no pulse', () => {
    const line = buildShareSnapshot({
      name: "Ramona's",
      pulseScore: 0,
      liveCheckInCount: 0,
      activeRewardCount: 0,
      tonight: null,
    })

    expect(line).toBe(`Ramona's ${DOT} Be the first in`)
  })
})

describe('buildShareSnapshot — clause rules', () => {
  it('pluralises the get count', () => {
    const line = buildShareSnapshot({
      name: 'Kitchener',
      pulseScore: 12,
      liveCheckInCount: 3,
      activeRewardCount: 2,
      tonight: null,
    })

    expect(line).toBe(`Kitchener ${DOT} Active ${DOT} 3 here now ${DOT} 2 gets live`)
  })

  it('omits the start time when it is not a local HH:mm', () => {
    const line = buildShareSnapshot({
      name: 'Kitchener',
      pulseScore: 70,
      liveCheckInCount: 4,
      activeRewardCount: 0,
      tonight: { headline: 'Live jazz', startsAt: null },
    })

    expect(line).toBe(`Kitchener ${DOT} Popping ${DOT} 4 here now ${DOT} Live jazz tonight`)
  })

  it('drops an empty headline rather than rendering a bare "tonight"', () => {
    const line = buildShareSnapshot({
      name: 'Kitchener',
      pulseScore: 4,
      liveCheckInCount: 1,
      activeRewardCount: 0,
      tonight: { headline: '   ', startsAt: '21:00' },
    })

    expect(line).toBe(`Kitchener ${DOT} Quiet right now ${DOT} 1 here now`)
  })
})
