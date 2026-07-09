/**
 * Property 4: Floor update convergence with audit-first ordering.
 *
 * **Validates: Requirements 4.4, 4.7, 5.2, 5.3, 10.5**
 *
 * For any finite sequence of in-range admin floor updates with arbitrary
 * `(duration, floorCents, admin)` tuples replayed against an in-memory
 * test double:
 *
 *   - The final `BoostFloor_Row` for each touched duration equals the
 *     last accepted update for that duration (R4.4, R10.5).
 *   - The count of `Floor_Change_Audit_Row` rows for that duration equals
 *     the count of accepted updates for that duration (R4.7, R10.5).
 *   - On an injected audit-write failure, the `BoostFloor_Row` is left
 *     untouched for that attempt — i.e. audit-first ordering is preserved
 *     so no reader can observe a new floor before its audit row is
 *     durable (R5.2, R5.3).
 *
 * Strategy:
 *   - A small `Map<string, Item>`-backed `documentClient` test double
 *     replaces the AWS SDK doc client via `vi.mock`. It models the
 *     `PutCommand` / `GetCommand` / `BatchGetCommand` / `QueryCommand`
 *     subset the repository uses, including `attribute_not_exists(pk)`
 *     conditional-check semantics and `ScanIndexForward=false` ordering.
 *   - A per-call `failNextAuditWrite` switch causes the next PutCommand
 *     targeting `pk='BOOST_FLOOR_AUDIT#…'` to throw a non-conditional
 *     error. The repository propagates the throw and the floor write is
 *     never attempted (per `writeFloorAuditThenUpdateFloor`'s contract).
 *   - The sequence is replayed against both the test double and an
 *     in-memory model. After each attempt and at the end of the
 *     sequence, the model and store are compared.
 */

import * as fc from 'fast-check'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// `vi.hoisted` runs before the `vi.mock` factories, so the spy references
// inside the factory are guaranteed to exist when the mock is installed.

const mocks = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>()
  const state = { failNextAuditWrite: false }

  function makeError(name: string, message: string): Error {
    const err = new Error(message)
    ;(err as { name: string }).name = name
    return err
  }

  const send = vi.fn(async (cmd: unknown) => {
    const ctorName: string = (cmd as { constructor?: { name?: string } })?.constructor?.name ?? ''
    const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

    // ── PutCommand ──────────────────────────────────────────────────────
    if (ctorName === 'PutCommand') {
      const item = input['Item'] as Record<string, unknown>
      const pk = item['pk']
      const sk = item['sk']

      // Audit-write failure injection: throw a non-conditional error on
      // the next PutCommand whose pk starts with 'BOOST_FLOOR_AUDIT#'.
      if (state.failNextAuditWrite && typeof pk === 'string' && pk.startsWith('BOOST_FLOOR_AUDIT#')) {
        state.failNextAuditWrite = false
        throw makeError('InternalServerError', 'Injected audit-write failure')
      }

      const condition = input['ConditionExpression'] as string | undefined
      const k = `${String(pk)}#${String(sk)}`
      if (condition === 'attribute_not_exists(pk)' && store.has(k)) {
        throw makeError('ConditionalCheckFailedException', 'attribute_not_exists(pk) failed')
      }
      store.set(k, item)
      return {}
    }

    // ── GetCommand ──────────────────────────────────────────────────────
    if (ctorName === 'GetCommand') {
      const key = input['Key'] as { pk: string; sk: string }
      const k = `${key.pk}#${key.sk}`
      const item = store.get(k)
      return item ? { Item: item } : {}
    }

    // ── DeleteCommand ───────────────────────────────────────────────────
    if (ctorName === 'DeleteCommand') {
      const key = input['Key'] as { pk: string; sk: string }
      store.delete(`${key.pk}#${key.sk}`)
      return {}
    }

    // ── BatchGetCommand ─────────────────────────────────────────────────
    if (ctorName === 'BatchGetCommand') {
      const requestItems = (input['RequestItems'] ?? {}) as Record<string, { Keys: Array<{ pk: string; sk: string }> }>
      const responses: Record<string, Record<string, unknown>[]> = {}
      for (const [tableName, req] of Object.entries(requestItems)) {
        const items: Record<string, unknown>[] = []
        for (const key of req.Keys) {
          const k = `${key.pk}#${key.sk}`
          const it = store.get(k)
          if (it) items.push(it)
        }
        responses[tableName] = items
      }
      return { Responses: responses }
    }

    // ── QueryCommand (pk-only equality on the base table) ────────────────
    if (ctorName === 'QueryCommand') {
      const vals = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>
      const targetPk = vals[':pk']
      const items = [...store.values()].filter((it) => it['pk'] === targetPk)
      items.sort((a, b) => String(a['sk']).localeCompare(String(b['sk'])))
      if (input['ScanIndexForward'] === false) items.reverse()
      const limit = (input['Limit'] as number | undefined) ?? items.length
      return { Items: items.slice(0, limit) }
    }

    return {}
  })

  return {
    store,
    state,
    send,
    reset() {
      store.clear()
      state.failNextAuditWrite = false
      send.mockClear()
    },
  }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: {
    appData: 'app-data',
    users: 'users',
    nodes: 'nodes',
    checkins: 'checkins',
    rewards: 'rewards',
    businesses: 'businesses',
    musicSchedules: 'music-schedules',
  },
}))

// Import AFTER the mock is installed so the module-level `documentClient`
// singleton picks up the test double.
import { updateBoostFloor } from '../service.js'
import type { BoostDuration } from '../types.js'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const DURATIONS: readonly BoostDuration[] = ['2hr', '6hr', '24hr'] as const

const durationArb: fc.Arbitrary<BoostDuration> = fc.constantFrom(...DURATIONS)

/** In-range floor cents, per R4.3 / R10.5. */
const floorCentsArb = fc.integer({ min: 1, max: 1_000_000 })

/** Admin identity. `sub` is a UUID, `email` is a synthesised valid address. */
const emailArb = fc
  .string({
    minLength: 1,
    maxLength: 16,
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  })
  .map((local) => `${local || 'a'}@example.com`)

const adminArb = fc.record({
  sub: fc.uuid(),
  email: emailArb,
})

interface UpdateAttempt {
  duration: BoostDuration
  floorCents: number
  admin: { sub: string; email: string }
  injectAuditFailure: boolean
}

/** Audit-write failure is intentionally rare (~10%) so most attempts are accepted. */
const attemptArb: fc.Arbitrary<UpdateAttempt> = fc
  .tuple(durationArb, floorCentsArb, adminArb, fc.integer({ min: 0, max: 9 }))
  .map(([duration, floorCents, admin, roll]) => ({
    duration,
    floorCents,
    admin,
    injectAuditFailure: roll === 0,
  }))

const sequenceArb = fc.array(attemptArb, { minLength: 0, maxLength: 50 })

// ─── Property 4 ─────────────────────────────────────────────────────────────

describe('Property 4: floor update convergence with audit-first ordering', () => {
  beforeEach(() => mocks.reset())

  it('final BoostFloor_Row equals the last accepted update; audit count matches accepted count; injected audit-write failures leave the floor row untouched', async () => {
    await fc.assert(
      fc.asyncProperty(sequenceArb, async (sequence) => {
        mocks.reset()

        // In-memory model: the source of truth the test double must converge to.
        const lastAcceptedFloor = new Map<BoostDuration, number>()
        const acceptedCount = new Map<BoostDuration, number>()

        for (const attempt of sequence) {
          const floorKey = `BOOST_FLOOR#${attempt.duration}`

          if (attempt.injectAuditFailure) {
            // Snapshot the floor row before the failed attempt. The
            // post-condition is that this row is identical after the
            // attempt rejects (R5.2, R5.3).
            const before = mocks.store.get(floorKey)
            mocks.state.failNextAuditWrite = true

            await expect(updateBoostFloor(attempt.duration, attempt.floorCents, null, attempt.admin)).rejects.toThrow()

            const after = mocks.store.get(floorKey)
            // Per-attempt invariant: a failed audit write never produces
            // a BoostFloor_Row update.
            expect(after).toEqual(before)
          } else {
            await updateBoostFloor(attempt.duration, attempt.floorCents, null, attempt.admin)
            lastAcceptedFloor.set(attempt.duration, attempt.floorCents)
            acceptedCount.set(attempt.duration, (acceptedCount.get(attempt.duration) ?? 0) + 1)
          }
        }

        // ── End-of-sequence assertions ─────────────────────────────────

        for (const duration of DURATIONS) {
          const expectedFloor = lastAcceptedFloor.get(duration)
          const row = mocks.store.get(`BOOST_FLOOR#${duration}`) as { floorCents: number; duration: string } | undefined

          if (expectedFloor === undefined) {
            // No accepted updates touched this duration — no row should
            // exist (the seed is a separate concern, not exercised here).
            expect(row).toBeUndefined()
          } else {
            expect(row).toBeDefined()
            expect(row?.floorCents).toBe(expectedFloor)
            expect(row?.duration).toBe(duration)
          }

          const expectedAuditCount = acceptedCount.get(duration) ?? 0
          const auditRows = [...mocks.store.values()].filter((it) => it['pk'] === `BOOST_FLOOR_AUDIT#${duration}`)
          expect(auditRows).toHaveLength(expectedAuditCount)
        }
      }),
      { numRuns: 25 },
    )
  })
})
