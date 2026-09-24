/**
 * The live panel's "today": one SAST calendar day, read to the last page.
 *
 * **Validates: Requirements 15.1**
 *
 * Two ways the owner's headline number used to lie, both fixed here:
 *
 *   1. It counted a rolling 24 hours, so at 09:00 it was still reporting last
 *      night. "Today" is now the SAST calendar day, and the boundary case is the
 *      instant either side of 00:00 SAST.
 *   2. It read one page of check-ins (`Limit: 50`) and dropped the cursor, so a
 *      busy night silently under-reported. The read now pages to completion.
 *
 * The check-ins table is modelled in memory against the real `NodeIndex` shape
 * (`nodeId` + numeric `timestamp`), including `LastEvaluatedKey`, so the
 * pagination under test is the real loop and not a mocked-away one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { SAST_OFFSET_MS } from '../../../shared/time/sast.js'

const PAGE_SIZE = 200

const h = vi.hoisted(() => {
  interface Row {
    checkInId: string
    nodeId: string
    userId: string
    timestamp: number
    checkedInAt: string
    foundVia?: string
  }

  const state = {
    nodes: [] as Array<{ nodeId: string; cityId?: string; totalCheckIns?: number }>,
    rows: [] as Row[],
  }

  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const input = cmd.input ?? {}

    if (input['IndexName'] === 'BusinessIndex') {
      return {
        Items: state.nodes.map((n) => ({
          nodeId: n.nodeId,
          name: n.nodeId,
          cityId: n.cityId,
          totalCheckIns: n.totalCheckIns,
        })),
      }
    }

    if (input['IndexName'] === 'NodeIndex') {
      const values = input['ExpressionAttributeValues'] as Record<string, unknown>
      const nodeId = values[':nodeId'] as string
      const since = values[':since'] as number
      const matching = state.rows
        .filter((row) => row.nodeId === nodeId && row.timestamp >= since)
        .sort((a, b) => b.timestamp - a.timestamp)

      const startKey = input['ExclusiveStartKey'] as { timestamp: number } | undefined
      const offset = startKey ? matching.findIndex((row) => row.timestamp === startKey.timestamp) + 1 : 0
      const limit = (input['Limit'] as number | undefined) ?? matching.length
      const page = matching.slice(offset, offset + limit)
      const last = page[page.length - 1]
      const exhausted = offset + page.length >= matching.length

      return {
        Items: page,
        ...(exhausted || !last ? {} : { LastEvaluatedKey: { checkInId: last.checkInId, timestamp: last.timestamp } }),
      }
    }

    return { Items: [] }
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

import { getLiveStats } from '../repository.js'

const BUSINESS_ID = 'biz-1'
const NODE_ID = 'node-a'

/** 00:00:00.000 SAST on a date, as epoch ms. */
function sastMidnightMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - SAST_OFFSET_MS
}

function seedRows(instants: number[]): void {
  h.state.rows = instants.map((ms, i) => ({
    checkInId: `ci-${i}`,
    nodeId: NODE_ID,
    userId: `u-${i}`,
    timestamp: ms,
    checkedInAt: new Date(ms).toISOString(),
    foundVia: 'map',
  }))
}

beforeEach(() => {
  h.sendMock.mockClear()
  h.state.nodes = [{ nodeId: NODE_ID, cityId: 'city-1', totalCheckIns: 4211 }]
  h.state.rows = []
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── The SAST day boundary ───────────────────────────────────────────────────

describe('getLiveStats counts the SAST calendar day', () => {
  const midnight = sastMidnightMs('2026-09-24')
  /** 21:00 SAST on the 23rd: peak trading, and two hours before the UTC day ends. */
  const lastEvening = midnight - 3 * 60 * 60 * 1000

  it('counts the evening trade one minute before midnight SAST', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(midnight - 60 * 1000))
    seedRows([lastEvening, lastEvening + 60 * 1000])

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.checkInsToday).toBe(2)
  })

  it('drops that same evening one minute after midnight SAST', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(midnight + 60 * 1000))
    // The two rows from last night, plus one from the new day.
    seedRows([lastEvening, lastEvening + 60 * 1000, midnight + 30 * 1000])

    const stats = await getLiveStats(BUSINESS_ID)

    // Only the row after midnight is today. A rolling 24-hour window would have
    // reported 3 and told the owner last night's crowd was here this morning.
    expect(stats.checkInsToday).toBe(1)
    // The read was bounded at this morning's 00:00 SAST, not 24 hours back.
    const nodeQuery = h.sendMock.mock.calls.find((c) => c[0]?.input?.['IndexName'] === 'NodeIndex')!
    const since = (nodeQuery[0].input['ExpressionAttributeValues'] as Record<string, number>)[':since']
    expect(since).toBe(midnight)
  })

  it('reads the lifetime total from the maintained node counter, uncapped', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(midnight + 60 * 1000))
    seedRows([midnight + 30 * 1000])

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.totalCheckIns).toBe(4211)
  })
})

// ─── Pagination ──────────────────────────────────────────────────────────────

describe('getLiveStats pages a busy venue to completion', () => {
  it('counts every check-in across a multi-page day', async () => {
    const midnight = sastMidnightMs('2026-09-24')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(midnight + 12 * 60 * 60 * 1000))

    // Two and a bit pages of a genuinely busy night.
    const total = PAGE_SIZE * 2 + 37
    seedRows(Array.from({ length: total }, (_, i) => midnight + (i + 1) * 1000))

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.checkInsToday).toBe(total)
    // The Receipt is computed from exactly those rows, so it cannot describe a
    // smaller day than the headline above it.
    expect(stats.receipt.foundYouVisitors).toBe(total)

    const nodeQueries = h.sendMock.mock.calls.filter((c) => c[0]?.input?.['IndexName'] === 'NodeIndex')
    expect(nodeQueries).toHaveLength(3)
    // Pages two and three are reached by cursor, not by a second unbounded read.
    expect(nodeQueries[1]![0].input['ExclusiveStartKey']).toBeDefined()
    expect(nodeQueries[2]![0].input['ExclusiveStartKey']).toBeDefined()
  })
})
