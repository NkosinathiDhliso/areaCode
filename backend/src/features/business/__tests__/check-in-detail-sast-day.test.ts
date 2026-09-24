/**
 * Business check-in detail, partitioned by the SAST calendar date (R15.8).
 *
 * **Validates: Requirements 15.8**
 *
 * The day is part of the partition key (`BIZ_CHECKIN#{businessId}#{date}`), so
 * the move off the UTC date cannot be backfilled by rewriting rows. Two
 * behaviours are pinned here:
 *
 *   1. "Today" and an explicit date are the SAST calendar day, so a 23:30
 *      check-in belongs to the night it happened on, not to tomorrow.
 *   2. For a date before the Phase 1 deploy boundary, the read also covers the
 *      partition the old UTC date put those rows in. A SAST day starts at 22:00
 *      UTC the previous day, so the first two hours were keyed under D-1; both
 *      partitions are read and every row is filtered to the SAST day by its own
 *      timestamp, so a check-in is reported on exactly one day and never twice.
 *
 * The app-data table is modelled in memory by partition key, so the query shapes
 * under test are the real ones.
 */

import { RECEIPT_MEASURED_FROM_ISO } from '@area-code/shared/constants/attribution'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { SAST_OFFSET_MS, sastDateString } from '../../../shared/time/sast.js'

const h = vi.hoisted(() => {
  const state = {
    /** pk -> rows, newest first (the table's ScanIndexForward: false order). */
    partitions: new Map<string, Array<Record<string, unknown>>>(),
    queriedPks: [] as string[],
  }

  const sendMock = vi.fn(async (cmd: { input: Record<string, unknown> }) => {
    const input = cmd.input ?? {}
    const values = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>
    const pk = values[':pk'] as string | undefined
    if (!pk) return { Items: [] }
    state.queriedPks.push(pk)
    const rows = [...(state.partitions.get(pk) ?? [])].sort((a, b) => String(b['sk']).localeCompare(String(a['sk'])))
    return { Items: rows }
  })

  return { state, sendMock }
})

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.sendMock } }
})

vi.mock('../../../shared/kv/dynamodb-kv.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/kv/dynamodb-kv.js')>()
  return { ...actual, kvGet: vi.fn(async () => null) }
})

vi.mock('../staff-leaderboard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../staff-leaderboard.js')>()
  return { ...actual, listRedemptionsForBusiness: vi.fn(async () => []) }
})

import { getCheckInDetails } from '../repository.js'

const BUSINESS_ID = 'biz-1'
const HOUR_MS = 60 * 60 * 1000

/** 00:00:00.000 SAST on a SAST date, as epoch ms. */
function sastMidnightMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - SAST_OFFSET_MS
}

/** Seed one cached row into the partition `date`, describing the instant `ms`. */
function seedRow(date: string, ms: number, displayName: string): void {
  const pk = `BIZ_CHECKIN#${BUSINESS_ID}#${date}`
  const rows = h.state.partitions.get(pk) ?? []
  rows.push({
    pk,
    sk: `CHECKIN#${ms}#ci-${displayName}`,
    displayName,
    tier: 'local',
    visitCount: 1,
    timestamp: new Date(ms).toISOString(),
    foundVia: 'map',
  })
  h.state.partitions.set(pk, rows)
}

function names(items: Array<{ displayName: string }>): string[] {
  return items.map((i) => i.displayName)
}

beforeEach(() => {
  h.sendMock.mockClear()
  h.state.partitions = new Map()
  h.state.queriedPks = []
})

afterEach(() => {
  vi.useRealTimers()
})

// A date well after the deploy boundary: new rows only, single partition.
const TODAY = '2026-10-15'
// A date before the boundary: UTC-keyed rows, dual read.
const LEGACY_DAY = '2026-09-20'

describe('getCheckInDetails, current dates (R15.8)', () => {
  it('defaults to the SAST date, so a 23:30 check-in is still tonight', async () => {
    vi.useFakeTimers()
    // 23:30 SAST on TODAY is already the next UTC day, which is exactly the
    // boundary the UTC partition got wrong.
    vi.setSystemTime(new Date(sastMidnightMs(TODAY) + 23.5 * HOUR_MS))
    seedRow(TODAY, sastMidnightMs(TODAY) + 23 * HOUR_MS, 'late-arrival')

    const { items } = await getCheckInDetails(BUSINESS_ID)

    expect(names(items)).toEqual(['late-arrival'])
    expect(h.state.queriedPks).toEqual([`BIZ_CHECKIN#${BUSINESS_ID}#${TODAY}`])
  })

  it('reads one partition and keeps cursor pagination for a post-deploy date', async () => {
    seedRow(TODAY, sastMidnightMs(TODAY) + 20 * HOUR_MS, 'a')

    const { items, nextCursor } = await getCheckInDetails(BUSINESS_ID, TODAY)

    expect(names(items)).toEqual(['a'])
    expect(nextCursor).toBeNull()
    expect(h.state.queriedPks).toHaveLength(1)
  })
})

describe('getCheckInDetails, pre-deploy dual read (R15.8)', () => {
  it('merges the UTC-keyed rows that landed in the previous day partition', async () => {
    // 00:30 SAST on the legacy day was 22:30 UTC the day before, so the old key
    // filed it under D-1.
    const justAfterMidnight = sastMidnightMs(LEGACY_DAY) + 30 * 60 * 1000
    const evening = sastMidnightMs(LEGACY_DAY) + 21 * HOUR_MS
    seedRow('2026-09-19', justAfterMidnight, 'after-midnight')
    seedRow(LEGACY_DAY, evening, 'evening')

    const { items, nextCursor } = await getCheckInDetails(BUSINESS_ID, LEGACY_DAY)

    // Both partitions read, rows merged newest first.
    expect(h.state.queriedPks).toEqual([
      `BIZ_CHECKIN#${BUSINESS_ID}#${LEGACY_DAY}`,
      `BIZ_CHECKIN#${BUSINESS_ID}#2026-09-19`,
    ])
    expect(names(items)).toEqual(['evening', 'after-midnight'])
    // A closed day is one page.
    expect(nextCursor).toBeNull()
  })

  it('never reports the same check-in on two days', async () => {
    // A UTC-keyed row at 23:00 UTC on the legacy day is 01:00 SAST the NEXT day.
    const nextDaySastEarly = sastMidnightMs('2026-09-21') + HOUR_MS
    seedRow(LEGACY_DAY, nextDaySastEarly, 'spills-over')

    const onLegacyDay = await getCheckInDetails(BUSINESS_ID, LEGACY_DAY)
    h.state.queriedPks = []
    const onNextDay = await getCheckInDetails(BUSINESS_ID, '2026-09-21')

    expect(names(onLegacyDay.items)).toEqual([])
    expect(names(onNextDay.items)).toEqual(['spills-over'])
  })

  it('drops a row that cannot be dated rather than claiming it for the day', async () => {
    const pk = `BIZ_CHECKIN#${BUSINESS_ID}#${LEGACY_DAY}`
    h.state.partitions.set(pk, [{ pk, sk: 'CHECKIN#not-a-number#ci-x', displayName: 'undatable', tier: 'local' }])

    const { items } = await getCheckInDetails(BUSINESS_ID, LEGACY_DAY)

    expect(items).toEqual([])
  })

  it('bounds the dual read at the Phase 1 deploy boundary', async () => {
    // The boundary date itself is post-deploy: single partition, no legacy read.
    const boundaryDate = sastDateString(RECEIPT_MEASURED_FROM_ISO)
    seedRow(boundaryDate, sastMidnightMs(boundaryDate) + 20 * HOUR_MS, 'on-boundary')

    const { items } = await getCheckInDetails(BUSINESS_ID, boundaryDate)

    expect(names(items)).toEqual(['on-boundary'])
    expect(h.state.queriedPks).toHaveLength(1)
  })
})
