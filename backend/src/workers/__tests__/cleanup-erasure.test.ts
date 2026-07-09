/**
 * Unit tests for the POPIA erasure processor in `workers/cleanup.ts` `handler()`
 * (Data Integrity Ops Hardening H7, tasks 2.1–2.6).
 *
 * Covers, for a pending `ERASURE#` request older than 30 days:
 *   - Completeness: every target store is cleared — checkins,
 *     websocket-connections, app-data (anchored partition Query + DeleteItem),
 *     the users row, and the Cognito account. (R2.1, R2.2, R2.2a, R2.3)
 *   - Complete-only-when-clear: the status=completed UpdateCommand runs ONLY
 *     when every deletion step succeeds. (R2.5)
 *   - Pending on failure: if any deletion step throws, the completion
 *     UpdateCommand is NOT sent, the failure is logged, and — critically for the
 *     retry path — the users row is NOT deleted before Cognito. (R2.6, R2.2a)
 *   - Pagination: the per-user app-data lookup paginates over LastEvaluatedKey
 *     and every page's rows are deleted (no rows missed). (R2.3)
 *
 * Strategy: the AWS SDK `documentClient` is stubbed and duck-types on the
 * command class name so we can drive the erasure Scan, the anchored app-data
 * Query pagination, and capture Delete/Update commands. The imported deletion
 * helpers (getUserById/deleteUser, deleteCheckInsByUser, deleteConnectionsByUser,
 * deleteUserByUsername) are mocked with vi. No live AWS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mock state ──────────────────────────────────────────────────────
//
// `vi.hoisted` runs before the `vi.mock` factories so the spies referenced
// inside the factories are defined when the mocks install.

const mocks = vi.hoisted(() => {
  const state = {
    erasureItems: [] as Array<Record<string, unknown>>,
    // When set, the ERASURE# pending-request scan returns two pages: page 1
    // carries these items plus a LastEvaluatedKey, page 2 carries
    // `erasureItems` and no cursor. Proves the do/while scan-cursor loop
    // advances and processes requests beyond the first page (R2.3).
    erasureItemsPage1: null as Array<Record<string, unknown>> | null,
    // When true, every app-data partition Query returns two pages (page 1
    // carries a LastEvaluatedKey), proving the do/while cursor loop advances.
    multiPageAppData: false,
    // Captures.
    deleteCommands: [] as Array<Record<string, unknown>>,
    updateCommands: [] as Array<Record<string, unknown>>,
    queryCommands: [] as Array<Record<string, unknown>>,
    scanCommands: [] as Array<Record<string, unknown>>,
  }

  const send = vi.fn(async (cmd: unknown) => {
    const name = (cmd as { constructor?: { name?: string } })?.constructor?.name
    const input = ((cmd as { input?: Record<string, unknown> })?.input ?? {}) as Record<string, unknown>
    const eav = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>

    if (name === 'ScanCommand') {
      state.scanCommands.push(input)
      // The erasure pending-request scan (prefix ERASURE#). Booster retention
      // sweeps use other prefixes and get an empty page so they no-op.
      if (eav[':prefix'] === 'ERASURE#') {
        // Two-page scan: page 1 returns `erasureItemsPage1` + a cursor so the
        // loop must fetch page 2 (`erasureItems`, no cursor → loop ends).
        if (state.erasureItemsPage1) {
          const hasCursor = Boolean(input['ExclusiveStartKey'])
          if (!hasCursor) {
            return { Items: state.erasureItemsPage1, LastEvaluatedKey: { pk: 'ERASURE#page1' } }
          }
          return { Items: state.erasureItems }
        }
        return { Items: state.erasureItems }
      }
      return { Items: [] }
    }

    if (name === 'QueryCommand') {
      state.queryCommands.push(input)
      const pk = eav[':pk'] as string
      const hasCursor = Boolean(input['ExclusiveStartKey'])
      if (state.multiPageAppData) {
        if (!hasCursor) {
          // Page 1: one row + a cursor so the loop must fetch page 2.
          return { Items: [{ pk, sk: `${pk}#p1` }], LastEvaluatedKey: { pk, sk: `${pk}#p1` } }
        }
        // Page 2: one more row, no cursor → loop terminates.
        return { Items: [{ pk, sk: `${pk}#p2` }] }
      }
      // Single page: one row per partition.
      return { Items: [{ pk, sk: `${pk}#only` }] }
    }

    if (name === 'DeleteCommand') {
      state.deleteCommands.push(input)
      return {}
    }
    if (name === 'UpdateCommand') {
      state.updateCommands.push(input)
      return {}
    }
    if (name === 'BatchWriteCommand') return {}
    return {}
  })

  return {
    state,
    send,
    getUserById: vi.fn(),
    deleteUser: vi.fn(),
    deleteCheckInsByUser: vi.fn(),
    deleteConnectionsByUser: vi.fn(),
    deleteUserByUsername: vi.fn(),
    cleanupOrphanedLocks: vi.fn(async () => ({ deleted: 0 })),
    startLapseSweep: vi.fn(async () => ({ graced: 0 })),
    enforceLapsedPayments: vi.fn(async () => ({ processed: 0 })),
  }
})

vi.mock('../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: {
    users: 'users',
    checkins: 'checkins',
    appData: 'app-data',
  },
}))

vi.mock('../../features/auth/dynamodb-repository.js', () => ({
  getUserById: mocks.getUserById,
  deleteUser: mocks.deleteUser,
}))

vi.mock('../../features/check-in/dynamodb-repository.js', () => ({
  deleteCheckInsByUser: mocks.deleteCheckInsByUser,
}))

vi.mock('../../shared/websocket/broadcast.js', () => ({
  deleteConnectionsByUser: mocks.deleteConnectionsByUser,
}))

vi.mock('../../shared/cognito/client.js', () => ({
  deleteUserByUsername: mocks.deleteUserByUsername,
}))

// Dynamically imported by handler() after the erasure loop — mock so the
// housekeeping tail does no real work.
vi.mock('../../features/rewards/threshold-lock.js', () => ({
  cleanupOrphanedLocks: mocks.cleanupOrphanedLocks,
}))
vi.mock('../../features/business/service.js', () => ({
  startLapseSweep: mocks.startLapseSweep,
  enforceLapsedPayments: mocks.enforceLapsedPayments,
}))

// Import AFTER mocks so the module-level singletons pick up the stubs.
import { handler } from '../cleanup'

// The 11 anchored app-data partitions the erasure loop clears per user:
// 8 owned (base table) + 3 referencing (GSI1).
const APP_DATA_PARTITION_COUNT = 11

function makeErasureRequest(userId: string): Record<string, unknown> {
  return {
    pk: `ERASURE#${userId}`,
    sk: `ERASURE#${userId}`,
    userId,
    status: 'pending',
    requestedAt: '2020-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  mocks.state.erasureItems = []
  mocks.state.erasureItemsPage1 = null
  mocks.state.multiPageAppData = false
  mocks.state.deleteCommands = []
  mocks.state.updateCommands = []
  mocks.state.queryCommands = []
  mocks.state.scanCommands = []

  mocks.send.mockClear()
  mocks.getUserById.mockReset()
  mocks.deleteUser.mockReset()
  mocks.deleteCheckInsByUser.mockReset()
  mocks.deleteConnectionsByUser.mockReset()
  mocks.deleteUserByUsername.mockReset()

  // Sensible defaults; individual tests override.
  mocks.getUserById.mockResolvedValue({ userId: 'u1', email: 'u1@example.com' })
  mocks.deleteUser.mockResolvedValue(undefined)
  mocks.deleteCheckInsByUser.mockResolvedValue(3)
  mocks.deleteConnectionsByUser.mockResolvedValue(2)
  mocks.deleteUserByUsername.mockResolvedValue(undefined)
})

describe('POPIA erasure processor — completeness (R2.1, R2.2, R2.2a, R2.3)', () => {
  it('clears every target store: checkins, websocket-connections, app-data, users row, and Cognito', async () => {
    mocks.state.erasureItems = [makeErasureRequest('u1')]

    const result = await handler()

    // checkins table
    expect(mocks.deleteCheckInsByUser).toHaveBeenCalledWith('u1')
    // websocket-connections table
    expect(mocks.deleteConnectionsByUser).toHaveBeenCalledWith('u1')
    // Cognito account (username resolved from the user row email)
    expect(mocks.deleteUserByUsername).toHaveBeenCalledWith('consumer', 'u1@example.com')
    // users row deleted
    expect(mocks.deleteUser).toHaveBeenCalledWith('u1')
    // app-data: one anchored Query + one DeleteItem per partition
    expect(mocks.state.queryCommands.length).toBe(APP_DATA_PARTITION_COUNT)
    expect(mocks.state.deleteCommands.length).toBe(APP_DATA_PARTITION_COUNT)

    expect(result.erasedCount).toBe(1)
  })

  it('resolves the Cognito username from the user row before deleting the users row (R2.2a)', async () => {
    mocks.state.erasureItems = [makeErasureRequest('u1')]
    const callOrder: string[] = []
    mocks.deleteUserByUsername.mockImplementation(async () => {
      callOrder.push('cognito')
    })
    mocks.deleteUser.mockImplementation(async () => {
      callOrder.push('users')
    })

    await handler()

    // Cognito account is deleted before the users row (which is the source of
    // truth for the Cognito username), so no run can orphan the account.
    expect(callOrder).toEqual(['cognito', 'users'])
  })
})

describe('POPIA erasure processor — complete-only-when-clear (R2.5)', () => {
  it('marks the request completed only after all deletions succeed', async () => {
    mocks.state.erasureItems = [makeErasureRequest('u1')]

    await handler()

    const completion = mocks.state.updateCommands.find(
      (u) => (u['ExpressionAttributeValues'] as Record<string, unknown>)?.[':completed'] === 'completed',
    )
    expect(completion).toBeDefined()
    expect(completion?.['Key']).toEqual({ pk: 'ERASURE#u1', sk: 'ERASURE#u1' })
  })
})

describe('POPIA erasure processor — pending on failure (R2.6, R2.2a)', () => {
  it('does not mark completed and does not delete the users row when a checkins deletion throws', async () => {
    mocks.state.erasureItems = [makeErasureRequest('u1')]
    mocks.deleteCheckInsByUser.mockRejectedValue(new Error('dynamo unavailable'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await handler()

    // No completion update — request stays pending for the next run.
    expect(mocks.state.updateCommands).toHaveLength(0)
    // Retry path stays correct: later steps never ran.
    expect(mocks.deleteUserByUsername).not.toHaveBeenCalled()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    // Failure is logged.
    expect(errSpy).toHaveBeenCalled()
    expect(result.erasedCount).toBe(0)

    errSpy.mockRestore()
  })

  it('does not delete the users row when the Cognito deletion throws (users row is the username source of truth)', async () => {
    mocks.state.erasureItems = [makeErasureRequest('u1')]
    mocks.deleteUserByUsername.mockRejectedValue(new Error('cognito throttled'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await handler()

    // Cognito failed → users row must survive so the next run can re-resolve
    // the username, and the request must stay pending.
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.state.updateCommands).toHaveLength(0)
    expect(errSpy).toHaveBeenCalled()
    expect(result.erasedCount).toBe(0)

    errSpy.mockRestore()
  })
})

describe('POPIA erasure processor — app-data lookup paginates (R2.3)', () => {
  it('processes every page of each anchored partition Query (no rows missed)', async () => {
    mocks.state.erasureItems = [makeErasureRequest('u1')]
    mocks.state.multiPageAppData = true

    await handler()

    // Each of the 11 partitions returns two pages of one row each. If the
    // cursor loop stopped at page 1, we would see 11 deletes; a complete
    // paginated sweep deletes both pages → 22.
    expect(mocks.state.deleteCommands.length).toBe(APP_DATA_PARTITION_COUNT * 2)
    // The second Query for a partition must carry the page-1 cursor.
    const cursoredQueries = mocks.state.queryCommands.filter((q) => Boolean(q['ExclusiveStartKey']))
    expect(cursoredQueries.length).toBe(APP_DATA_PARTITION_COUNT)
  })
})

describe('POPIA erasure processor — pending-request scan paginates (R2.3)', () => {
  it('processes requests beyond the first scan page (no pending request missed)', async () => {
    // Page 1 carries u1 + a LastEvaluatedKey; page 2 carries u2 and no cursor.
    // If the scan stopped at page 1, u2 would never be erased.
    mocks.state.erasureItemsPage1 = [makeErasureRequest('u1')]
    mocks.state.erasureItems = [makeErasureRequest('u2')]
    // Resolve a distinct Cognito email per user so both deletions are provable.
    mocks.getUserById.mockImplementation(async (userId: string) => ({
      userId,
      email: `${userId}@example.com`,
    }))

    const result = await handler()

    // The scan looped: a second ScanCommand for the ERASURE# prefix carried the
    // page-1 cursor.
    const erasureScans = mocks.state.scanCommands.filter(
      (s) => (s['ExpressionAttributeValues'] as Record<string, unknown>)?.[':prefix'] === 'ERASURE#',
    )
    const cursoredErasureScans = erasureScans.filter((s) => Boolean(s['ExclusiveStartKey']))
    expect(cursoredErasureScans.length).toBe(1)

    // BOTH users fully erased: checkins, connections, Cognito, and users row.
    for (const userId of ['u1', 'u2']) {
      expect(mocks.deleteCheckInsByUser).toHaveBeenCalledWith(userId)
      expect(mocks.deleteConnectionsByUser).toHaveBeenCalledWith(userId)
      expect(mocks.deleteUserByUsername).toHaveBeenCalledWith('consumer', `${userId}@example.com`)
      expect(mocks.deleteUser).toHaveBeenCalledWith(userId)
    }

    // Both requests marked completed, and the aggregate count reflects both.
    const completions = mocks.state.updateCommands.filter(
      (u) => (u['ExpressionAttributeValues'] as Record<string, unknown>)?.[':completed'] === 'completed',
    )
    expect(completions.length).toBe(2)
    expect(result.erasedCount).toBe(2)
  })
})
