/**
 * Unit tests for `summariseTonight` (proof-of-demand task 9.1).
 *
 * Tonight is derived from the Dated_Slot the owner published on the existing
 * Music_Schedule, at read time, with no second store. These tests pin the four
 * decisions the function owns:
 *
 *  - the slot running now wins and reports no start time (it already started)
 *  - otherwise the soonest dated slot still to come reports its local start
 *  - a night that runs past midnight is still Tonight in the small hours, and is
 *    not offered again on the following evening
 *  - nothing published, only weekly slots, or a dated slot for another date
 *    yields `null`, so the surface renders nothing rather than a placeholder
 *  - the featured get's title is dropped the moment the get stops being live
 *
 * Every venue runs on Africa/Johannesburg (SAST, fixed UTC+2, no DST), so a
 * local instant converts to UTC by subtracting two hours.
 *
 * _Requirements: 8.5_
 */

import type { MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '@area-code/shared/types'
import { describe, it, expect } from 'vitest'

import { resolveTonightSlot, summariseTonight, type TonightFeaturedGet } from '../tonight-summary.js'

const TIMEZONE = 'Africa/Johannesburg'

/** 2026-03-06 is a Friday. */
const FRIDAY = '2026-03-06'
const SATURDAY = '2026-03-07'

/** The UTC instant for a SAST wall-clock time on a given local date. */
function sastIso(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00.000+02:00`).toISOString()
}

function minutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number)
  return hh! * 60 + mm!
}

function slot(args: {
  slotId: string
  dayOfWeek: ScheduleDayOfWeek
  startTime: string
  endTime: string
  date?: string
  headline?: string
  featuredRewardId?: string
  genres?: ScheduleSlot['genres']
  lineup?: ScheduleSlot['lineup']
}): ScheduleSlot {
  const startTimeMin = minutes(args.startTime)
  const endMin = minutes(args.endTime)
  const built: ScheduleSlot = {
    slotId: args.slotId,
    dayOfWeek: args.dayOfWeek,
    startTime: args.startTime,
    endTime: args.endTime,
    startTimeMin,
    // Mirrors the validator's derivation, which every stored slot has been
    // through: a dated night ending at or before its start runs past midnight,
    // so its derived end is on the following morning.
    endTimeMin: args.date !== undefined && endMin <= startTimeMin ? endMin + 24 * 60 : endMin,
    mode: args.lineup ? 'lineup' : 'blanket',
  }
  if (args.lineup) built.lineup = args.lineup
  else built.genres = args.genres ?? ['amapiano']
  if (args.date !== undefined) built.date = args.date
  if (args.headline !== undefined) built.headline = args.headline
  if (args.featuredRewardId !== undefined) built.featuredRewardId = args.featuredRewardId
  return built
}

function schedule(slots: ScheduleSlot[]): MusicSchedule {
  return {
    businessId: 'biz-1',
    scheduleId: 'default',
    timezone: TIMEZONE,
    slots,
    updatedAt: '2026-03-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

const liveGet: TonightFeaturedGet = { title: 'Free welcome drink', isActive: true }

// ─── The active slot ─────────────────────────────────────────────────────────

describe('summariseTonight, the running dated slot', () => {
  it('returns the headline with no start time while the slot is running', () => {
    const tonight = summariseTonight({
      schedule: schedule([
        slot({
          slotId: 'dated-1',
          dayOfWeek: 'FRI',
          date: FRIDAY,
          startTime: '20:00',
          endTime: '23:59',
          headline: 'Amapiano all night',
        }),
      ]),
      nowIso: sastIso(FRIDAY, '21:30'),
    })

    // `startsAt: null` is the "already running" signal the share snapshot and
    // the detail block both key on.
    expect(tonight).toEqual({
      headline: 'Amapiano all night',
      startsAt: null,
      archetypeId: expect.stringMatching(/^archetype-/),
    })
  })

  it('prefers the running slot over a later one on the same night', () => {
    const tonight = summariseTonight({
      schedule: schedule([
        slot({
          slotId: 'late',
          dayOfWeek: 'FRI',
          date: FRIDAY,
          startTime: '23:00',
          endTime: '23:59',
          headline: 'After hours',
        }),
        slot({
          slotId: 'early',
          dayOfWeek: 'FRI',
          date: FRIDAY,
          startTime: '19:00',
          endTime: '23:00',
          headline: 'Opening set',
        }),
      ]),
      nowIso: sastIso(FRIDAY, '19:05'),
    })

    expect(tonight?.headline).toBe('Opening set')
    expect(tonight?.startsAt).toBeNull()
  })

  it('takes the covering lineup entry for a running lineup slot', () => {
    const lineupSlot = slot({
      slotId: 'lineup-1',
      dayOfWeek: 'FRI',
      date: FRIDAY,
      startTime: '20:00',
      endTime: '23:59',
      headline: 'Three DJs',
      lineup: [
        { startTime: '20:00', startTimeMin: 1200, djName: 'Opener', genres: ['jazz'] },
        { startTime: '22:00', startTimeMin: 1320, djName: 'Headliner', genres: ['amapiano'] },
      ],
    })

    const opener = summariseTonight({ schedule: schedule([lineupSlot]), nowIso: sastIso(FRIDAY, '20:30') })
    const headliner = summariseTonight({ schedule: schedule([lineupSlot]), nowIso: sastIso(FRIDAY, '22:30') })

    // Different genres resolve to different taste cues, so the block describes
    // who is on now rather than who opened.
    expect(opener?.archetypeId).not.toBe(headliner?.archetypeId)
  })
})

// ─── The next dated slot ─────────────────────────────────────────────────────

describe('summariseTonight, the next dated slot', () => {
  it('returns the soonest upcoming slot with its local start time', () => {
    const tonight = summariseTonight({
      schedule: schedule([
        slot({
          slotId: 'later',
          dayOfWeek: 'FRI',
          date: FRIDAY,
          startTime: '23:00',
          endTime: '23:59',
          headline: 'After hours',
        }),
        slot({
          slotId: 'sooner',
          dayOfWeek: 'FRI',
          date: FRIDAY,
          startTime: '21:00',
          endTime: '23:00',
          headline: 'Amapiano set',
        }),
      ]),
      nowIso: sastIso(FRIDAY, '18:00'),
    })

    expect(tonight?.headline).toBe('Amapiano set')
    expect(tonight?.startsAt).toBe('21:00')
  })

  it('does not look past the current local night', () => {
    const tomorrowOnly = schedule([
      slot({
        slotId: 'sat',
        dayOfWeek: 'SAT',
        date: SATURDAY,
        startTime: '21:00',
        endTime: '23:59',
        headline: 'Saturday session',
      }),
    ])

    expect(summariseTonight({ schedule: tomorrowOnly, nowIso: sastIso(FRIDAY, '22:00') })).toBeNull()
    // The same slot is Tonight once its own date arrives.
    expect(summariseTonight({ schedule: tomorrowOnly, nowIso: sastIso(SATURDAY, '18:00') })?.headline).toBe(
      'Saturday session',
    )
  })

  it('reads the local date in the schedule timezone, not UTC', () => {
    // 23:30 SAST on Friday is 21:30 UTC on Friday, but 00:30 SAST on Saturday
    // is 22:30 UTC on FRIDAY. The Saturday slot must resolve at that instant.
    const both = schedule([
      slot({ slotId: 'fri', dayOfWeek: 'FRI', date: FRIDAY, startTime: '20:00', endTime: '23:59', headline: 'Friday' }),
      slot({ slotId: 'sat', dayOfWeek: 'SAT', date: SATURDAY, startTime: '01:00', endTime: '04:00', headline: 'Sat' }),
    ])

    expect(summariseTonight({ schedule: both, nowIso: '2026-03-06T21:30:00.000Z' })?.headline).toBe('Friday')
    expect(summariseTonight({ schedule: both, nowIso: '2026-03-06T22:30:00.000Z' })?.headline).toBe('Sat')
  })
})

// ─── A night that runs past midnight ─────────────────────────────────────────

describe('summariseTonight, a night that runs past midnight (decision 12)', () => {
  const pastMidnight = schedule([
    slot({
      slotId: 'fri-late',
      dayOfWeek: 'FRI',
      date: FRIDAY,
      startTime: '21:00',
      endTime: '02:00',
      headline: 'Amapiano till 2',
    }),
  ])

  it('is still running at 01:00 on Saturday', () => {
    // The hour the calendar-date rule used to lose: one hour past midnight, with
    // the venue at its fullest and the Tonight_Reminder sent an hour ago.
    const tonight = summariseTonight({ schedule: pastMidnight, nowIso: sastIso(SATURDAY, '01:00') })

    expect(tonight?.headline).toBe('Amapiano till 2')
    // Running, so no start time: it already started.
    expect(tonight?.startsAt).toBeNull()
  })

  it('is running through the whole night and gone the minute it ends', () => {
    for (const at of ['21:00', '23:59']) {
      expect(summariseTonight({ schedule: pastMidnight, nowIso: sastIso(FRIDAY, at) })?.startsAt).toBeNull()
    }
    for (const at of ['00:00', '01:59']) {
      expect(summariseTonight({ schedule: pastMidnight, nowIso: sastIso(SATURDAY, at) })?.startsAt).toBeNull()
    }
    expect(summariseTonight({ schedule: pastMidnight, nowIso: sastIso(SATURDAY, '02:00') })).toBeNull()
  })

  it("does not offer Friday's night again on Saturday evening", () => {
    // A stale headline on the following evening is the bug the Cross_Midnight_Pair
    // alternative would have introduced. A night names one night.
    expect(summariseTonight({ schedule: pastMidnight, nowIso: sastIso(SATURDAY, '19:00') })).toBeNull()
    expect(summariseTonight({ schedule: pastMidnight, nowIso: sastIso(SATURDAY, '22:00') })).toBeNull()
  })

  it("prefers Friday's running night over Saturday's published one at 01:00", () => {
    const both = schedule([
      slot({
        slotId: 'fri-late',
        dayOfWeek: 'FRI',
        date: FRIDAY,
        startTime: '21:00',
        endTime: '02:00',
        headline: 'Amapiano till 2',
      }),
      slot({
        slotId: 'sat',
        dayOfWeek: 'SAT',
        date: SATURDAY,
        startTime: '21:00',
        endTime: '23:59',
        headline: 'Saturday session',
      }),
    ])

    expect(summariseTonight({ schedule: both, nowIso: sastIso(SATURDAY, '01:00') })?.headline).toBe('Amapiano till 2')
    // Once Friday's night ends, Saturday's is the one still to come.
    expect(summariseTonight({ schedule: both, nowIso: sastIso(SATURDAY, '03:00') })?.headline).toBe('Saturday session')
  })
})

// ─── Null: nothing to say ────────────────────────────────────────────────────

describe('summariseTonight, null when nothing is published', () => {
  it('returns null for a missing schedule', () => {
    expect(summariseTonight({ schedule: null, nowIso: sastIso(FRIDAY, '20:00') })).toBeNull()
    expect(summariseTonight({ schedule: undefined, nowIso: sastIso(FRIDAY, '20:00') })).toBeNull()
  })

  it('returns null for an empty schedule', () => {
    expect(summariseTonight({ schedule: schedule([]), nowIso: sastIso(FRIDAY, '20:00') })).toBeNull()
  })

  it('ignores weekly slots: the ordinary programme is not a published Tonight', () => {
    const weekly = schedule([
      slot({ slotId: 'weekly-fri', dayOfWeek: 'FRI', startTime: '20:00', endTime: '23:59', headline: 'Every Friday' }),
    ])

    expect(summariseTonight({ schedule: weekly, nowIso: sastIso(FRIDAY, '21:00') })).toBeNull()
  })

  it('ignores a dated slot with no headline: there is nothing honest to render', () => {
    const noHeadline = schedule([
      slot({ slotId: 'dated-1', dayOfWeek: 'FRI', date: FRIDAY, startTime: '20:00', endTime: '23:59' }),
    ])
    const blankHeadline = schedule([
      slot({
        slotId: 'dated-2',
        dayOfWeek: 'FRI',
        date: FRIDAY,
        startTime: '20:00',
        endTime: '23:59',
        headline: '   ',
      }),
    ])

    expect(summariseTonight({ schedule: noHeadline, nowIso: sastIso(FRIDAY, '21:00') })).toBeNull()
    expect(summariseTonight({ schedule: blankHeadline, nowIso: sastIso(FRIDAY, '21:00') })).toBeNull()
  })

  it('returns null once the night is over', () => {
    const done = schedule([
      slot({
        slotId: 'dated-1',
        dayOfWeek: 'FRI',
        date: FRIDAY,
        startTime: '18:00',
        endTime: '20:00',
        headline: 'Set',
      }),
    ])

    expect(summariseTonight({ schedule: done, nowIso: sastIso(FRIDAY, '21:00') })).toBeNull()
  })

  it('returns null for an unresolvable clock rather than guessing', () => {
    const published = schedule([
      slot({ slotId: 'd', dayOfWeek: 'FRI', date: FRIDAY, startTime: '20:00', endTime: '23:59', headline: 'Set' }),
    ])

    expect(summariseTonight({ schedule: published, nowIso: 'not-a-timestamp' })).toBeNull()
    expect(
      summariseTonight({ schedule: { ...published, timezone: 'Mars/Olympus' }, nowIso: '2026-03-06T20:00:00Z' }),
    ).toBeNull()
  })
})

// ─── The featured get ────────────────────────────────────────────────────────

describe('summariseTonight, the featured get', () => {
  const withGet = schedule([
    slot({
      slotId: 'dated-1',
      dayOfWeek: 'FRI',
      date: FRIDAY,
      startTime: '20:00',
      endTime: '23:59',
      headline: 'Amapiano all night',
      featuredRewardId: 'reward-1',
    }),
  ])
  const now = sastIso(FRIDAY, '21:00')

  it('carries the title and the id when the get is live', () => {
    const tonight = summariseTonight({ schedule: withGet, nowIso: now, featuredGet: liveGet })

    expect(tonight?.rewardTitle).toBe('Free welcome drink')
    // The id travels with the title so the detail can open the get's own row.
    expect(tonight?.featuredRewardId).toBe('reward-1')
  })

  it('omits the get when it is switched off', () => {
    const tonight = summariseTonight({ schedule: withGet, nowIso: now, featuredGet: { ...liveGet, isActive: false } })

    expect(tonight?.headline).toBe('Amapiano all night')
    expect(tonight?.rewardTitle).toBeUndefined()
    expect(tonight?.featuredRewardId).toBeUndefined()
  })

  it('omits the get when its window has ended', () => {
    const ended = { ...liveGet, endsAt: sastIso(FRIDAY, '19:00') }
    const expired = { ...liveGet, expiresAt: sastIso(FRIDAY, '19:00') }

    expect(summariseTonight({ schedule: withGet, nowIso: now, featuredGet: ended })?.rewardTitle).toBeUndefined()
    expect(summariseTonight({ schedule: withGet, nowIso: now, featuredGet: expired })?.rewardTitle).toBeUndefined()
  })

  it('omits the get when it could not be read', () => {
    expect(summariseTonight({ schedule: withGet, nowIso: now, featuredGet: null })?.rewardTitle).toBeUndefined()
    expect(summariseTonight({ schedule: withGet, nowIso: now })?.rewardTitle).toBeUndefined()
  })

  it('ignores a get on a slot that carries no featuredRewardId', () => {
    const noReference = schedule([
      slot({ slotId: 'd', dayOfWeek: 'FRI', date: FRIDAY, startTime: '20:00', endTime: '23:59', headline: 'Set' }),
    ])

    expect(summariseTonight({ schedule: noReference, nowIso: now, featuredGet: liveGet })?.rewardTitle).toBeUndefined()
  })
})

// ─── Business-wide scope ─────────────────────────────────────────────────────

describe('resolveTonightSlot, business-wide scope', () => {
  it('resolves from the business schedule alone, with no node input', () => {
    // Tonight scope is business-wide (`docs/decisions/proof-of-demand.md`
    // decision 5): the schedule is the only input, so every venue of a
    // multi-venue business necessarily reads the same Tonight.
    const published = schedule([
      slot({
        slotId: 'dated-1',
        dayOfWeek: 'FRI',
        date: FRIDAY,
        startTime: '21:00',
        endTime: '23:59',
        headline: 'Amapiano all night',
      }),
    ])
    const now = sastIso(FRIDAY, '18:00')

    const resolved = resolveTonightSlot(published, now)

    expect(resolved?.slot.slotId).toBe('dated-1')
    expect(resolved?.startsAt).toBe('21:00')
    // Same schedule, same answer, every time: no per-node state is consulted.
    expect(summariseTonight({ schedule: published, nowIso: now })).toEqual(
      summariseTonight({ schedule: published, nowIso: now }),
    )
  })
})
