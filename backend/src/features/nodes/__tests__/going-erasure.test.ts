/**
 * Erasure of a consumer's Going rows (proof-of-demand R9.9, task 10.8).
 *
 * A Going mark is two rows: the countable one in the venue partition and the
 * mirror in the consumer's own partition. The mirror exists for exactly this
 * moment: `pk USER#{userId}` plus `begins_with(sk, 'GOING#')` finds every night
 * the person marked, with no scan, so erasure is affordable.
 *
 * What these cases pin:
 *
 *  - both partitions are cleared, for every night, in the one transaction the
 *    write path uses. A venue row left behind would keep an erased person inside
 *    the owner's count
 *  - the lookup is a Query on the consumer's partition, never a Scan
 *  - the venue count drops by exactly the marks that person made
 *  - re-running is a no-op, so a retried erasure does not error
 *
 * _Requirements: 9.9_
 */

import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    /** Mirror rows the consumer's partition holds, as `{ nodeId, date }`. */
    mirrors: [] as Array<{ nodeId: string; date: string }>,
    /** Venue rows, keyed `pk|sk`, so a count can be taken before and after. */
    venueRows: new Set<string>(),
    commands: [] as unknown[],
  }

  const send = vi.fn(async (command: unknown) => {
    state.commands.push(command)
    const name = (command as { constructor?: { name?: string } })?.constructor?.name
    const input = ((command as { input?: Record<string, unknown> })?.input ?? {}) as Record<string, unknown>

    if (name === 'QueryCommand') {
      const eav = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>
      if (eav[':skPrefix'] === 'GOING#') {
        return { Items: state.mirrors.map((m) => ({ nodeId: m.nodeId, date: m.date })) }
      }
      // A venue-partition count.
      const pk = eav[':pk'] as string
      return { Count: [...state.venueRows].filter((row) => row.startsWith(`${pk}|`)).length }
    }

    if (name === 'TransactWriteCommand') {
      for (const item of (input['TransactItems'] ?? []) as Array<Record<string, any>>) {
        const key = item['Delete']?.Key
        if (key) state.venueRows.delete(`${key.pk}|${key.sk}`)
      }
      return {}
    }

    return {}
  })

  return { state, send }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: { appData: 'area-code-test-app-data' },
}))

import { goingUserPk, goingVenuePk, goingVenueSk } from '../going'
import { countGoing, deleteGoingRowsForUser, listGoingMirrorRows } from '../going-repository'

const USER = 'user-1'
const OTHER_USER = 'user-2'
const NODE_A = 'node-a'
const NODE_B = 'node-b'
const FRIDAY = '2026-03-06'
const SATURDAY = '2026-03-07'
const NOW_SECONDS = Math.floor(Date.parse('2026-03-07T20:00:00.000Z') / 1000)

/** Two nights for the erased consumer, plus a stranger's mark at one of them. */
function seedTwoNights(): void {
  mocks.state.mirrors = [
    { nodeId: NODE_A, date: FRIDAY },
    { nodeId: NODE_B, date: SATURDAY },
  ]
  mocks.state.venueRows = new Set([
    `${goingVenuePk(NODE_A, FRIDAY)}|${goingVenueSk(USER)}`,
    `${goingVenuePk(NODE_B, SATURDAY)}|${goingVenueSk(USER)}`,
    `${goingVenuePk(NODE_A, FRIDAY)}|${goingVenueSk(OTHER_USER)}`,
  ])
}

beforeEach(() => {
  mocks.send.mockClear()
  mocks.state.commands = []
  mocks.state.mirrors = []
  mocks.state.venueRows = new Set()
})

describe('deleteGoingRowsForUser clears both partitions (R9.9)', () => {
  it('deletes the venue row and the mirror row for every night, as one transaction each', async () => {
    seedTwoNights()

    const pairs = await deleteGoingRowsForUser(USER)

    expect(pairs).toBe(2)
    const transactions = mocks.state.commands.filter((c) => c instanceof TransactWriteCommand) as TransactWriteCommand[]
    expect(transactions).toHaveLength(2)

    const deletedKeys = transactions.flatMap((t) =>
      (t.input.TransactItems ?? []).map((item) => item.Delete?.Key as { pk: string; sk: string }),
    )
    expect(deletedKeys).toEqual([
      // Friday at node A: countable row then mirror row.
      { pk: goingVenuePk(NODE_A, FRIDAY), sk: goingVenueSk(USER) },
      { pk: goingUserPk(USER), sk: `GOING#${FRIDAY}#${NODE_A}` },
      // Saturday at node B.
      { pk: goingVenuePk(NODE_B, SATURDAY), sk: goingVenueSk(USER) },
      { pk: goingUserPk(USER), sk: `GOING#${SATURDAY}#${NODE_B}` },
    ])
  })

  it("drops the venue count by exactly this consumer's marks, leaving other people alone", async () => {
    seedTwoNights()

    expect(await countGoing(NODE_A, FRIDAY, NOW_SECONDS)).toBe(2)
    expect(await countGoing(NODE_B, SATURDAY, NOW_SECONDS)).toBe(1)

    await deleteGoingRowsForUser(USER)

    // The stranger's mark at node A survives; the erased consumer's marks are gone.
    expect(await countGoing(NODE_A, FRIDAY, NOW_SECONDS)).toBe(1)
    expect(await countGoing(NODE_B, SATURDAY, NOW_SECONDS)).toBe(0)
  })

  it('finds the nights by Query on the consumer partition, never a Scan', async () => {
    seedTwoNights()

    await deleteGoingRowsForUser(USER)

    const queries = mocks.state.commands.filter((c) => c instanceof QueryCommand) as QueryCommand[]
    const lookup = queries[0]
    expect(lookup?.input.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :skPrefix)')
    expect(lookup?.input.ExpressionAttributeValues).toMatchObject({
      ':pk': goingUserPk(USER),
      ':skPrefix': 'GOING#',
    })
    // Nothing in this path may scan the table.
    expect(mocks.state.commands.some((c) => c.constructor.name === 'ScanCommand')).toBe(false)
  })

  it('is a no-op for a consumer who never marked going, and on a retried run', async () => {
    expect(await deleteGoingRowsForUser(USER)).toBe(0)
    expect(mocks.state.commands.filter((c) => c instanceof TransactWriteCommand)).toHaveLength(0)

    seedTwoNights()
    await deleteGoingRowsForUser(USER)
    // Second pass: the mirror partition is empty now, so there is nothing to redo.
    mocks.state.mirrors = []
    expect(await deleteGoingRowsForUser(USER)).toBe(0)
  })
})

describe('listGoingMirrorRows reads only what it can trust', () => {
  it('skips a row missing its venue or night rather than guessing at a key', async () => {
    mocks.state.mirrors = [{ nodeId: NODE_A, date: FRIDAY }]
    mocks.send.mockImplementationOnce(async () => ({
      Items: [{ nodeId: NODE_A, date: FRIDAY }, { nodeId: NODE_B }, { date: SATURDAY }],
    }))

    expect(await listGoingMirrorRows(USER)).toEqual([{ userId: USER, nodeId: NODE_A, date: FRIDAY }])
  })
})
