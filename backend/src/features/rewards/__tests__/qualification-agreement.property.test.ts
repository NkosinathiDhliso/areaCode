import * as fc from 'fast-check'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Loyalty Repeat Redemption — qualification-agreement property test.
 *
 * Covers Property 3 (Qualification agreement) from the design doc. Given an
 * arbitrary stored state (check-ins of mixed types, an optional Threshold_Lock,
 * a `triggerValue`), the Reward_Evaluator's mint-time qualification decision and
 * the consumer-facing progress read (`getRewardEligibility`) must be identical,
 * and both must honour the Effective_Threshold `min(lockedThreshold, triggerValue)`.
 *
 * The two paths are exercised end-to-end against a single shared in-memory
 * DynamoDB store so they observe exactly the same state:
 *  - progress path: the real `getRewardEligibility` read.
 *  - evaluator path: the real reward-evaluator `handler`; a mint (a redemption
 *    row appearing in the store) means the evaluator qualified the get.
 * Both bottom out at `documentClient.send`, which is the one seam we mock.
 *
 * **Validates: Requirements 3.1, 3.2, 3.4**
 */

// ─── Shared in-memory DynamoDB store (hoisted so vi.mock can close over it) ──

const h = vi.hoisted(() => {
  const T = {
    rewards: 'rewards',
    nodes: 'nodes',
    checkins: 'checkins',
    appData: 'appData',
    users: 'users',
    businesses: 'businesses',
    presence: 'presence',
    musicSchedules: 'musicSchedules',
  }

  interface Store {
    rewards: Map<string, Record<string, unknown>>
    nodes: Map<string, Record<string, unknown>>
    checkins: Array<Record<string, unknown>>
    appData: Map<string, Record<string, unknown>>
  }

  const store: Store = {
    rewards: new Map(),
    nodes: new Map(),
    checkins: [],
    appData: new Map(),
  }

  return { T, store }
})

vi.mock('../../../shared/db/dynamodb.js', () => {
  const { T, store } = h
  const appDataKey = (pk: unknown, sk: unknown): string => `${String(pk)}|${String(sk)}`

  const documentClient = {
    // Minimal DynamoDB emulator covering exactly the command shapes the two
    // qualification paths issue. Anything outside those shapes is a no-op.
    async send(command: { constructor: { name: string }; input: Record<string, any> }) {
      const name = command.constructor.name
      const input = command.input ?? {}
      const table = input.TableName
      const values: Record<string, unknown> = input.ExpressionAttributeValues ?? {}

      if (name === 'GetCommand') {
        if (table === T.rewards) return { Item: store.rewards.get(input.Key.rewardId) }
        if (table === T.nodes) return { Item: store.nodes.get(input.Key.nodeId) }
        if (table === T.appData) return { Item: store.appData.get(appDataKey(input.Key.pk, input.Key.sk)) }
        return { Item: undefined }
      }

      if (name === 'QueryCommand') {
        if (table === T.rewards) {
          // getActiveRewardsByNodeId: NodeIndex + isActive + unexpired filter.
          const items = [...store.rewards.values()].filter((r) => {
            const active = r['isActive'] === values[':isActive']
            const notExpired = r['expiresAt'] === undefined || (r['expiresAt'] as string) > (values[':now'] as string)
            return r['nodeId'] === values[':nodeId'] && active && notExpired
          })
          return { Items: items, Count: items.length }
        }
        if (table === T.checkins) {
          // countQualifyingVisits: userId (key) + nodeId + type='reward'.
          const matched = store.checkins.filter(
            (c) =>
              c['userId'] === values[':userId'] && c['nodeId'] === values[':nodeId'] && c['type'] === values[':type'],
          )
          return { Count: matched.length, Items: input.Select === 'COUNT' ? undefined : matched }
        }
        return { Items: [], Count: 0 }
      }

      if (name === 'PutCommand') {
        const item = input.Item as Record<string, unknown>
        if (table === T.appData) {
          const key = appDataKey(item['pk'], item['sk'])
          if (input.ConditionExpression) {
            // Claim-guard condition: attribute_not_exists(pk) OR codeExpiresAt < :now.
            const existing = store.appData.get(key)
            if (existing) {
              const now = values[':now'] as string
              const expired = existing['codeExpiresAt'] !== undefined && (existing['codeExpiresAt'] as string) < now
              if (!expired) {
                const err = new Error('conditional check failed') as Error & { name: string }
                err.name = 'ConditionalCheckFailedException'
                throw err
              }
            }
          }
          store.appData.set(key, item)
          return {}
        }
        if (table === T.rewards) {
          store.rewards.set(item['rewardId'] as string, item)
          return {}
        }
        if (table === T.nodes) {
          store.nodes.set(item['nodeId'] as string, item)
          return {}
        }
        return {}
      }

      if (name === 'UpdateCommand') {
        if (table === T.rewards) {
          // incrementClaimedCount (slot-cap uncapped here): claimedCount += 1.
          const rewardId = input.Key.rewardId as string
          const existing = store.rewards.get(rewardId) ?? { rewardId }
          const updated = { ...existing, claimedCount: ((existing['claimedCount'] as number) ?? 0) + 1 }
          store.rewards.set(rewardId, updated)
          return { Attributes: updated }
        }
        return { Attributes: input.Key ?? {} }
      }

      if (name === 'DeleteCommand') {
        if (table === T.appData) store.appData.delete(appDataKey(input.Key.pk, input.Key.sk))
        return {}
      }

      if (name === 'ScanCommand') return { Items: [], Count: 0 }
      return {}
    },
  }

  return {
    documentClient,
    client: {},
    TableNames: T,
    isConditionalCheckFailedError: (err: unknown) =>
      (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
  }
})

// Socket fan-out is irrelevant to the qualification decision. emitRewardClaimed
// returns a non-zero "reached" count so the evaluator never falls back to the
// push-notification path (which would pull in unrelated modules).
vi.mock('../../../shared/socket/events.js', () => ({
  emitRewardClaimed: vi.fn(async () => 1),
  emitRewardSlotsUpdate: vi.fn(async () => {}),
  emitToast: vi.fn(async () => {}),
  emitBusinessRewardClaimed: vi.fn(async () => {}),
}))

// Imported AFTER the mocks so they resolve against the emulated store.
const { handler } = await import('../../../workers/reward-evaluator.js')
const { getRewardEligibility } = await import('../dynamodb-repository.js')

// ─── Fixtures and helpers ────────────────────────────────────────────────────

const USER_ID = 'user-qual-1'
const REWARD_ID = 'reward-qual-1'
const TARGET_NODE = 'node-target'
const OTHER_NODE = 'node-other'

interface Scenario {
  trigger: number
  rewardVisits: number
  noiseReward: number // reward-type check-ins at a DIFFERENT node (must not count)
  noisePresence: number // presence check-ins at the target node (must not count)
  lockedThreshold: number | null // null => no Threshold_Lock
}

function seedStore(s: Scenario): void {
  h.store.rewards.clear()
  h.store.nodes.clear()
  h.store.appData.clear()
  h.store.checkins = []

  h.store.rewards.set(REWARD_ID, {
    rewardId: REWARD_ID,
    id: REWARD_ID,
    nodeId: TARGET_NODE,
    type: 'nth_checkin',
    title: 'Free coffee',
    isActive: true,
    triggerValue: s.trigger,
    claimedCount: 0,
  })

  h.store.nodes.set(TARGET_NODE, { nodeId: TARGET_NODE, name: 'Target Cafe' })

  if (s.lockedThreshold !== null) {
    const pk = `LOCK#${USER_ID}#${REWARD_ID}`
    h.store.appData.set(`${pk}|LOCK`, {
      pk,
      sk: 'LOCK',
      userId: USER_ID,
      rewardId: REWARD_ID,
      lockedThreshold: s.lockedThreshold,
      firstCheckInAt: new Date(0).toISOString(),
      currentVisits: s.rewardVisits,
    })
  }

  for (let i = 0; i < s.rewardVisits; i++) {
    h.store.checkins.push({ userId: USER_ID, nodeId: TARGET_NODE, type: 'reward' })
  }
  for (let i = 0; i < s.noiseReward; i++) {
    h.store.checkins.push({ userId: USER_ID, nodeId: OTHER_NODE, type: 'reward' })
  }
  for (let i = 0; i < s.noisePresence; i++) {
    h.store.checkins.push({ userId: USER_ID, nodeId: TARGET_NODE, type: 'presence' })
  }
}

/** True if the evaluator minted a redemption for the get (a REDEMPTION# row). */
function evaluatorMinted(): boolean {
  for (const key of h.store.appData.keys()) {
    if (key.startsWith('REDEMPTION#')) return true
  }
  return false
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  trigger: fc.integer({ min: 1, max: 8 }),
  rewardVisits: fc.integer({ min: 0, max: 10 }),
  noiseReward: fc.integer({ min: 0, max: 5 }),
  noisePresence: fc.integer({ min: 0, max: 5 }),
  lockedThreshold: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
})

// ─── Property 3: Qualification agreement ─────────────────────────────────────

describe('Feature: loyalty-repeat-redemption, Property 3: Qualification agreement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('evaluator qualification and progress eligibility agree, honouring min(lockedThreshold, triggerValue)', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        seedStore(scenario)

        // Effective_Threshold = min(lockedThreshold, triggerValue) when a lock
        // exists, else the raw triggerValue (R3.1). Only reward-type visits at
        // THIS node count toward it (R3.2).
        const effectiveThreshold =
          scenario.lockedThreshold === null ? scenario.trigger : Math.min(scenario.lockedThreshold, scenario.trigger)
        const qualifyingCount = scenario.rewardVisits
        const expectedEligible = qualifyingCount >= effectiveThreshold

        // Progress read first (read-only), before the evaluator mutates state.
        const progress = await getRewardEligibility(USER_ID, REWARD_ID)

        expect(progress.currentCheckIns).toBe(qualifyingCount)
        expect(progress.requiredCheckIns).toBe(effectiveThreshold)
        expect(progress.eligible).toBe(expectedEligible)

        // Evaluator decision: run the real worker and observe the mint.
        await handler({
          Records: [{ body: JSON.stringify({ userId: USER_ID, nodeId: TARGET_NODE, checkInId: 'ci-1' }) }],
        })
        const minted = evaluatorMinted()

        // R3.4: the two decisions must be identical.
        expect(minted).toBe(expectedEligible)
        expect(minted).toBe(progress.eligible)
      }),
      { numRuns: 200 },
    )
  })
})
