/**
 * The Going seed on the live-panel read (proof-of-demand R9.5, task 10.4 gap).
 *
 * **Validates: Requirements 9.5**
 *
 * `business:going` tells the owner when the count MOVES. Without a seed the
 * panel had nothing to move from: an owner opening it at 20:00 with five marks
 * already recorded saw no Going line at all until somebody toggled, which reads
 * as an empty pipeline rather than as the pipeline they have.
 *
 * What is locked here:
 *
 *   1. Every venue the server counted travels with its name and its count, so
 *      the panel can label the line without a second read.
 *   2. A venue whose partition could not be counted is ABSENT, not zero.
 *      Unmeasured and empty are different facts (`honest-presence.md`).
 *   3. A measured zero IS reported. The owner watching the pipeline before doors
 *      needs the drop as much as the rise (R9.5).
 *   4. The count comes from the one Going reader, which owns the night rule, so
 *      the owner's number and the consumer's card cannot disagree about which
 *      night they are describing.
 *   5. The DEV_MODE fixture stays the first statement in the guard and never
 *      reaches the production read (`scripts/assert-dormant-paths.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    devMode: false,
    nodes: [] as Array<{ nodeId: string; name?: string; cityId?: string }>,
    /** What the Going reader reports. A node absent from the map was not counted. */
    goingCounts: new Map<string, number>(),
  }

  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    if (cmd.constructor.name === 'QueryCommand' && cmd.input?.['IndexName'] === 'BusinessIndex') {
      return { Items: state.nodes }
    }
    return { Items: [] }
  })

  const loadGoingCountByNodeMock = vi.fn(async (nodeIds: readonly string[]) => {
    const counts = new Map<string, number>()
    for (const nodeId of nodeIds) {
      const count = state.goingCounts.get(nodeId)
      if (count !== undefined) counts.set(nodeId, count)
    }
    return counts
  })

  return { state, sendMock, loadGoingCountByNodeMock }
})

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
  return { ...actual, getCheckInsByNode: vi.fn(async () => ({ checkIns: [] })) }
})

vi.mock('../staff-leaderboard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../staff-leaderboard.js')>()
  return { ...actual, listRedemptionsForBusiness: vi.fn(async () => []) }
})

// The Going reader is imported at call time by the service (it reaches the socket
// emitter, which the report and campaign workers must not have to load). `vi.mock`
// intercepts the dynamic import all the same.
vi.mock('../../nodes/going-service.js', () => ({ loadGoingCountByNode: h.loadGoingCountByNodeMock }))

import { getLiveStats } from '../service.js'

const BUSINESS_ID = 'biz-1'

function twoVenues(): void {
  h.state.nodes = [
    { nodeId: 'node-a', name: 'The Lookout', cityId: 'city-1' },
    { nodeId: 'node-b', name: 'Yard 12', cityId: 'city-1' },
  ]
}

beforeEach(() => {
  h.state.devMode = false
  h.state.nodes = []
  h.state.goingCounts = new Map()
  h.sendMock.mockClear()
  h.loadGoingCountByNodeMock.mockClear()
})

// ─── The seed ────────────────────────────────────────────────────────────────

describe("getLiveStats seeds tonight's Going marks per venue (R9.5)", () => {
  it('names each counted venue with its count', async () => {
    twoVenues()
    h.state.goingCounts = new Map([
      ['node-a', 5],
      ['node-b', 2],
    ])

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.goingTonight).toEqual([
      { nodeId: 'node-a', nodeName: 'The Lookout', goingCount: 5 },
      { nodeId: 'node-b', nodeName: 'Yard 12', goingCount: 2 },
    ])
  })

  it('reports a measured zero, so the owner sees the drop as well as the rise', async () => {
    twoVenues()
    h.state.goingCounts = new Map([
      ['node-a', 0],
      ['node-b', 3],
    ])

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.goingTonight).toEqual([
      { nodeId: 'node-a', nodeName: 'The Lookout', goingCount: 0 },
      { nodeId: 'node-b', nodeName: 'Yard 12', goingCount: 3 },
    ])
  })

  it('omits a venue it could not count, rather than calling it empty', async () => {
    twoVenues()
    // node-b's partition failed to read, so the reader left it out.
    h.state.goingCounts = new Map([['node-a', 4]])

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.goingTonight).toEqual([{ nodeId: 'node-a', nodeName: 'The Lookout', goingCount: 4 }])
  })

  it("asks the one Going reader for exactly the business's venues", async () => {
    twoVenues()

    await getLiveStats(BUSINESS_ID)

    expect(h.loadGoingCountByNodeMock).toHaveBeenCalledTimes(1)
    expect(h.loadGoingCountByNodeMock).toHaveBeenCalledWith(['node-a', 'node-b'])
  })

  it('reads nothing for a business with no venues', async () => {
    h.state.nodes = []

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.goingTonight).toEqual([])
    expect(h.loadGoingCountByNodeMock).not.toHaveBeenCalled()
  })

  it('leaves the aliveness numbers untouched: intent is never presence (R9.4)', async () => {
    twoVenues()
    h.state.goingCounts = new Map([['node-a', 40]])

    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.checkInsToday).toBe(0)
    expect(stats.totalCheckIns).toBe(0)
    expect(stats.foundYouToday).toBe(0)
    expect(stats.walkInsToday).toBe(0)
  })
})

// ─── DEV_MODE fixture ────────────────────────────────────────────────────────

describe('getLiveStats DEV_MODE Going fixture', () => {
  beforeEach(() => {
    h.state.devMode = true
  })

  it('returns a seeded line above the threshold so a dev run shows the real surface', async () => {
    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.goingTonight).toHaveLength(1)
    expect(stats.goingTonight[0]?.goingCount).toBeGreaterThanOrEqual(3)
  })

  it('never reaches the production Going read', async () => {
    await getLiveStats(BUSINESS_ID)

    expect(h.loadGoingCountByNodeMock).not.toHaveBeenCalled()
    expect(h.sendMock).not.toHaveBeenCalled()
  })
})
