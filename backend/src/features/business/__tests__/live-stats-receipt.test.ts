/**
 * Live panel Receipt split: `getLiveStats` returns `foundYouToday` and
 * `walkInsToday`, plus the two sentences that describe them.
 *
 * **Validates: Requirements 4.3**
 *
 * Three things are locked here, each one a way the number could stop being
 * honest:
 *
 *   1. The split is computed from the same check-in rows `checkInsToday`
 *      counts, through `computeReceipt`. The live panel therefore reports the
 *      same arithmetic as the Monday digest, not a second count that can drift.
 *   2. The sentences come from `buildReceiptCopy` with the `today` window
 *      label. There is one wording of the Found_You fact and the portal renders
 *      it verbatim.
 *   3. The DEV_MODE fixture stays inside the guard and is worded by the same
 *      builder, so a dev run rehearses the real sentences and the production
 *      read is never bypassed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mutable mock state (vi.hoisted so the factories can reference it) ────────

const h = vi.hoisted(() => {
  interface RepoCheckIn {
    userId: string
    checkedInAt: string
    foundVia?: string
  }

  const state = {
    devMode: true,
    nodes: [] as Array<{ nodeId: string; cityId?: string }>,
    checkInsByNode: new Map<string, RepoCheckIn[]>(),
  }

  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    if (cmd.constructor.name === 'QueryCommand' && cmd.input?.['IndexName'] === 'BusinessIndex') {
      return { Items: state.nodes.map((n) => ({ nodeId: n.nodeId, cityId: n.cityId })) }
    }
    return { Items: [] }
  })

  const getCheckInsByNodeMock = vi.fn(async (nodeId: string) => ({
    checkIns: state.checkInsByNode.get(nodeId) ?? [],
  }))
  // The live panel's day read. Rows in the fixture are all inside today's SAST
  // day; the window arithmetic itself is proven in live-stats-sast-day.test.ts.
  const getCheckInsByNodeSinceMock = vi.fn(async (nodeId: string) => state.checkInsByNode.get(nodeId) ?? [])

  return { state, sendMock, getCheckInsByNodeMock, getCheckInsByNodeSinceMock }
})

// DEV_MODE is a live binding read inside `getLiveStats`, so a getter lets one
// suite drive both branches without reloading the module graph.
vi.mock('../../../shared/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/config/env.js')>()
  return {
    ...actual,
    get DEV_MODE() {
      return h.state.devMode
    },
  }
})

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.sendMock } }
})

vi.mock('../../../shared/kv/dynamodb-kv.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/kv/dynamodb-kv.js')>()
  return { ...actual, kvGet: vi.fn(async () => null) }
})

vi.mock('../../check-in/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../check-in/dynamodb-repository.js')>()
  return {
    ...actual,
    getCheckInsByNode: h.getCheckInsByNodeMock,
    getCheckInsByNodeSince: h.getCheckInsByNodeSinceMock,
  }
})

vi.mock('../staff-leaderboard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../staff-leaderboard.js')>()
  return { ...actual, listRedemptionsForBusiness: vi.fn(async () => []) }
})

import { getLiveStats } from '../service.js'

const BUSINESS_ID = 'biz-1'

/** Two nodes so the split is proven to aggregate across a business's venues. */
function loadCheckIns(nodeA: Array<[string, string | undefined]>, nodeB: Array<[string, string | undefined]>): void {
  h.state.nodes = [
    { nodeId: 'node-a', cityId: 'city-1' },
    { nodeId: 'node-b', cityId: 'city-1' },
  ]
  const rows = (pairs: Array<[string, string | undefined]>, hour: number) =>
    pairs.map(([userId, foundVia], i) => ({
      userId,
      checkedInAt: new Date(Date.now() - (hour + i) * 60 * 60 * 1000).toISOString(),
      ...(foundVia === undefined ? {} : { foundVia }),
    }))
  h.state.checkInsByNode = new Map([
    ['node-a', rows(nodeA, 1)],
    ['node-b', rows(nodeB, 2)],
  ])
}

beforeEach(() => {
  h.state.devMode = false
  h.sendMock.mockClear()
  h.getCheckInsByNodeMock.mockClear()
  h.getCheckInsByNodeSinceMock.mockClear()
  loadCheckIns([], [])
})

// ─── Production read (R4.3) ──────────────────────────────────────────────────

describe('getLiveStats splits today into Found_You and Walk_In visitors', () => {
  it('counts distinct consumers per side and words both lines for the today window', async () => {
    // u1 and u4 from the map, u2 from a shared link, u6 from a notification.
    // u3 and u5 have no source. u1 checks in twice, once without a source: a
    // repeat visit must not move them to the walk-in side or count them twice.
    loadCheckIns(
      [
        ['u1', 'map'],
        ['u1', undefined],
        ['u2', 'share'],
        ['u3', undefined],
        ['u4', 'map'],
      ],
      [
        ['u5', undefined],
        ['u6', 'push'],
      ],
    )

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.foundYouToday).toBe(4)
    expect(stats.walkInsToday).toBe(2)
    // Conservation: every consumer in the window is on exactly one side.
    expect(stats.foundYouToday + stats.walkInsToday).toBe(6)

    expect(stats.receiptToday.headline).toBe('4 people found you on Area Code and checked in today.')
    expect(stats.receiptToday.walkIn).toBe('2 people who were already in the room also checked in.')
  })

  it('reads a check-in with no recorded source as a walk-in, never as found you', async () => {
    loadCheckIns([['u1', undefined]], [])

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.foundYouToday).toBe(0)
    expect(stats.walkInsToday).toBe(1)
    // Zero takes the plain branch: no "0 people found you" headline.
    expect(stats.receiptToday.headline).toBe('No one has found you on Area Code and checked in today yet.')
    expect(stats.receiptToday.headline).not.toContain('0 ')
    expect(stats.receiptToday.walkIn).toBe('1 person who was already in the room also checked in.')
  })

  it('reports a quiet day honestly, with no fabricated counts', async () => {
    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.foundYouToday).toBe(0)
    expect(stats.walkInsToday).toBe(0)
    expect(stats.checkInsToday).toBe(0)
    expect(stats.receiptToday.headline).toBe('No one has found you on Area Code and checked in today yet.')
    expect(stats.receiptToday.walkIn).toBe('No check-ins were recorded from people already in the room.')
  })

  it('never describes the venue as having been brought or driven anyone', async () => {
    loadCheckIns([['u1', 'map']], [['u2', 'share']])

    const stats = await getLiveStats(BUSINESS_ID)

    const copy = `${stats.receiptToday.headline} ${stats.receiptToday.walkIn}`.toLowerCase()
    for (const verb of ['brought', 'drove', 'generated', 'boosted', 'revenue', 'ticket', 'spend']) {
      expect(copy).not.toContain(verb)
    }
  })
})

// ─── DEV_MODE fixture (code-style: no synthetic data outside the guard) ───────

describe('getLiveStats DEV_MODE fixture', () => {
  beforeEach(() => {
    h.state.devMode = true
  })

  it('returns a split that sums to its own unique-visitor count, worded by the shared builder', async () => {
    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.foundYouToday).toBe(9)
    expect(stats.walkInsToday).toBe(13)
    expect(stats.receiptToday.headline).toBe('9 people found you on Area Code and checked in today.')
    expect(stats.receiptToday.walkIn).toBe('13 people who were already in the room also checked in.')
  })

  it('never reaches the production read', async () => {
    await getLiveStats(BUSINESS_ID)

    expect(h.getCheckInsByNodeMock).not.toHaveBeenCalled()
    expect(h.getCheckInsByNodeSinceMock).not.toHaveBeenCalled()
    expect(h.sendMock).not.toHaveBeenCalled()
  })
})
