/**
 * End-to-end dev rehearsal for proof of demand (spec task 12.2).
 *
 * **Validates: Requirements 13.2, 13.6**
 *
 * ─── What this stands in for ─────────────────────────────────────────────────
 *
 * Task 12.2 is "walk the whole loop in dev": a share link that previews and
 * opens, a Found_You check-in and a Walk_In check-in, a Going mark with the
 * reminder at slot start, the live panel's four counts, a boost scoreboard, and
 * the Monday digest carrying the new lines. Real browsers, a real dev SES inbox,
 * a real Yoco checkout and a real EventBridge tick cannot run inside the
 * automated suite, so this file is the durable, replayable evidence for
 * everything that does not need them, and `docs/UAT_PROOF_OF_DEMAND.md` carries
 * the script a human runs on the live stack. The live-stack pass is still
 * outstanding; the list of what only it can prove is at the bottom of this
 * comment.
 *
 * Modelled on `two-device-rehearsal.test.ts` (task 3.8) and
 * `digest-pipeline-rehearsal.test.ts`: the REAL modules are wired together over
 * ONE in-memory DynamoDB, so the row one act writes is the exact row the next
 * act reads back.
 *
 * The fixture is the task 12.1 dev seed, derived through the seed's own pure
 * plan and row builders (`scripts/seed-proof-of-demand-plan.ts` and `-rows.ts`).
 * Every number asserted below therefore comes from the same source as the table
 * in `docs/UAT_PROOF_OF_DEMAND.md`: the harness and the documented figures
 * cannot drift. Only the row SHAPES are restated here, reduced to the attributes
 * these read paths touch, because the writer script
 * (`scripts/seed-proof-of-demand.ts`) is an entry point rather than a module.
 *
 * ─── The acts, in order ──────────────────────────────────────────────────────
 *
 * They share one store on purpose: this is one rehearsal, not eight unit tests.
 *
 *   1. Share link. `GET /v1/share/node/:slug` renders the Share_Preview for the
 *      seeded venue, then tester t01 records the arrival through
 *      `POST /v1/nodes/:nodeId/open` with `source: 'share'`, `away: true`.
 *   2. Attribution. t01 checks in more than `AWAY_GATE_MIN_MINUTES` later and is
 *      stamped `foundVia: 'share'`; t02 scans the printed QR cold and is stamped
 *      `walk_in`. The fan-out carries both stamps.
 *   3. Going. t01 marks going for tonight and asks to be reminded; the count
 *      moves past `GOING_PUBLIC_THRESHOLD` and the owner's room is told.
 *   4. Live panel. `getLiveStats` reports the four counts (today's check-ins,
 *      Found_You, Walk_In, Going tonight) and the two Receipt sentences.
 *   5. Boost scoreboard. A booster purchase written through the real
 *      idempotency choreography (the dev checkout, minus Yoco) produces the
 *      window and baseline readings, and a closed window is cached, not
 *      recomputed.
 *   6. Monday digest, seeded week. One weekly pass per seeded business produces
 *      the documented Receipt lines for all three Receipt branches: clear of the
 *      Suppression_Floor, below it, and zero Found_You.
 *   7. Tonight_Reminder. The schedule transition tick at the Dated_Slot start
 *      delivers t01's reminder once, and a second tick over the same window
 *      delivers nothing.
 *   8. Monday digest, rehearsal week. The following Monday's pass carries the
 *      Going line, naming the marks and the measured overlap.
 *
 * ─── Fidelity: what is real vs mocked ────────────────────────────────────────
 *
 * REAL (exercised end to end):
 *   - the Share_Preview route and the public venue read behind it (pulse KV,
 *     Tonight from the schedule, Going count, active gets);
 *   - the Venue_Open route and service with their Zod validation and the
 *     DynamoDB sliding-window rate limiter;
 *   - the Away_Gate (`resolveFoundVia`), the check-in service that stamps
 *     `foundVia`, and QR token validation over the real HMAC accessor;
 *   - the Going routes, service and transactional repository, the Going night
 *     rule and the row TTL;
 *   - the schedule repository (including the sparse `ByNextTransition` GSI), the
 *     transition tick's window arithmetic and the Tonight_Reminder claim;
 *   - `computeReceipt`, `buildReceiptCopy`, `computeBoostScoreboard`, the
 *     scoreboard read with its closed-window cache, `getLiveStats`;
 *   - the digest generator, its PII scan and its conditional write;
 *   - the socket emitters and the business room fan-out.
 *
 * MOCKED (environment seams, not domain logic):
 *   - DynamoDB (`documentClient.send`), backed by an in-memory store;
 *   - the Cognito verifier, so a request carries an identity without JWKS;
 *   - the WebSocket transport, so the fan-out is observable;
 *   - SES, so the Digest_Email send is observable;
 *   - `sendNotification`, so the reminder delivery is observable. Its preference
 *     gate is covered by `nodes/__tests__/tonight-reminder.test.ts`; the seeded
 *     `tonightReminder` rows are written here anyway so the fixture matches;
 *   - presence records, redemptions, social, threshold locks, milestones,
 *     First-Get rows and the live-archetype evaluator: reads this spec does not
 *     change.
 *
 * ─── What the live-stack pass must still verify ──────────────────────────────
 *
 * Out of scope here, and therefore still outstanding as a manual pass
 * (`docs/UAT_PROOF_OF_DEMAND.md`, scenarios S2 to S8):
 *   - the WhatsApp / Slack link unfurl actually rendering the Open Graph tags,
 *     and the script redirect landing a real browser on the venue card;
 *   - a real handset's position producing `away: true`, and a real camera
 *     scanning the printed QR;
 *   - the owner's panels re-rendering on the socket events;
 *   - a real Yoco dev checkout producing the purchase row;
 *   - the Monday digest and the trial reminder arriving in a dev SES inbox;
 *   - the EventBridge minute tick firing the reminder, and the push notification
 *     arriving on a phone.
 *
 * Runs under the standard `pnpm test` (default node env), never gated on
 * DEV_MODE.
 */

import { createHmac } from 'node:crypto'

import { AWAY_GATE_MIN_MINUTES, GOING_PUBLIC_THRESHOLD } from '@area-code/shared/constants/attribution'
import { getTier } from '@area-code/shared/constants/tier-levels'
import type { FastifyInstance } from 'fastify'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

import {
  historyConsumers,
  SEED_ACTIVITY,
  SEED_CITY,
  SEED_TESTERS,
  SEED_VENUES,
  venueFor,
} from '../../../scripts/seed-proof-of-demand-plan.js'
import {
  buildCheckIns,
  buildGoingMarks,
  buildPresence,
  buildTonightSlot,
  buildVenueOpens,
  checkInSastDate,
  closedDigestWeek,
  TONIGHT_START,
} from '../../../scripts/seed-proof-of-demand-rows.js'
import { SUPPRESSION_FLOOR } from '../suppression.js'

// ─── In-memory DynamoDB and the environment seams (vi.hoisted) ────────────────

const h = vi.hoisted(() => {
  /** One store behind every table. Keys mirror the real table key schemas. */
  const tables = new Map<string, Map<string, Record<string, unknown>>>()

  const keyAttrs = (table: string): string[] => {
    if (table.endsWith('app-data')) return ['pk', 'sk']
    if (table.endsWith('music-schedules')) return ['pk', 'sk']
    if (table.endsWith('users')) return ['userId']
    if (table.endsWith('nodes')) return ['nodeId']
    if (table.endsWith('checkins')) return ['checkInId', 'timestamp']
    if (table.endsWith('businesses')) return ['businessId']
    if (table.endsWith('rewards')) return ['rewardId']
    if (table.endsWith('presence')) return ['userId', 'nodeId']
    throw new Error(`[rehearsal] no key schema modelled for table ${table}`)
  }

  const tableOf = (name: string): Map<string, Record<string, unknown>> => {
    const existing = tables.get(name)
    if (existing) return existing
    const created = new Map<string, Record<string, unknown>>()
    tables.set(name, created)
    return created
  }

  const rowKey = (table: string, item: Record<string, unknown>): string =>
    keyAttrs(table)
      .map((attr) => String(item[attr]))
      .join('\u0000')

  const attrName = (token: string, names?: Record<string, string>): string =>
    token.startsWith('#') ? (names?.[token] ?? token.slice(1)) : token

  const compareValues = (a: unknown, b: unknown): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a).localeCompare(String(b))
  }

  /** Split on a separator at parenthesis depth zero. */
  const splitTopLevel = (expression: string, separator: string): string[] => {
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (let i = 0; i < expression.length; i++) {
      const char = expression[i]!
      if (char === '(') depth++
      if (char === ')') depth--
      if (depth === 0 && expression.startsWith(separator, i)) {
        parts.push(current)
        current = ''
        i += separator.length - 1
        continue
      }
      current += char
    }
    parts.push(current)
    return parts.map((part) => part.trim()).filter((part) => part.length > 0)
  }

  /**
   * Normalise a condition so AND / OR can be split structurally: `BETWEEN` is
   * rewritten to its two comparisons first, because the `AND` inside it is not a
   * boolean operator.
   */
  const normaliseCondition = (expression: string): string =>
    expression
      .replace(/(#?[\w.]+)\s+BETWEEN\s+(:\w+)\s+AND\s+(:\w+)/gi, '($1 >= $2 && $1 <= $3)')
      .replace(/\s+AND\s+/gi, ' && ')
      .replace(/\s+OR\s+/gi, ' || ')

  /** Evaluate one leaf term: a function call or a comparison. */
  const evaluateTerm = (
    item: Record<string, unknown>,
    clause: string,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): boolean => {
    const exists = /^attribute_(not_)?exists\(\s*(#?[\w.]+)\s*\)$/.exec(clause)
    if (exists) {
      const present = item[attrName(exists[2]!, names)] !== undefined
      return exists[1] ? !present : present
    }
    const begins = /^begins_with\(\s*(#?[\w.]+)\s*,\s*(:\w+)\s*\)$/.exec(clause)
    if (begins) {
      const actual = item[attrName(begins[1]!, names)]
      return String(actual ?? '').startsWith(String(values?.[begins[2]!]))
    }
    const comparison = /^(#?[\w.]+)\s*(>=|<=|<>|=|>|<)\s*(:\w+)$/.exec(clause)
    if (!comparison) throw new Error(`[rehearsal] unsupported condition: ${clause}`)
    const actual = item[attrName(comparison[1]!, names)]
    const expected = values?.[comparison[3]!]
    if (actual === undefined) return false
    switch (comparison[2]) {
      case '=':
        return actual === expected
      case '<>':
        return actual !== expected
      case '>=':
        return compareValues(actual, expected) >= 0
      case '<=':
        return compareValues(actual, expected) <= 0
      case '>':
        return compareValues(actual, expected) > 0
      default:
        return compareValues(actual, expected) < 0
    }
  }

  /** Evaluate a key condition, filter or condition expression. */
  const evaluate = (
    item: Record<string, unknown>,
    expression: string | undefined,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
    normalised = false,
  ): boolean => {
    if (!expression) return true
    let clause = (normalised ? expression : normaliseCondition(expression)).trim()
    while (clause.startsWith('(') && splitTopLevel(clause, '&&').length === 1 && clause.endsWith(')')) {
      const inner = clause.slice(1, -1)
      if (splitTopLevel(inner, ')').length > 1 && !inner.includes('(')) break
      clause = inner.trim()
    }
    const ors = splitTopLevel(clause, '||')
    if (ors.length > 1) return ors.some((part) => evaluate(item, part, names, values, true))
    const ands = splitTopLevel(clause, '&&')
    if (ands.length > 1) return ands.every((part) => evaluate(item, part, names, values, true))
    return evaluateTerm(item, clause, names, values)
  }

  const conditionalFailure = (): Error => {
    const err = new Error('The conditional request failed') as Error & { name: string }
    err.name = 'ConditionalCheckFailedException'
    return err
  }

  /** Split on top-level commas, so `if_not_exists(#v, :zero) + :inc` survives. */
  const splitAssignments = (body: string): string[] => {
    const parts: string[] = []
    let depth = 0
    let current = ''
    for (const char of body) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (char === ',' && depth === 0) {
        parts.push(current)
        current = ''
        continue
      }
      current += char
    }
    parts.push(current)
    return parts.map((part) => part.trim()).filter((part) => part.length > 0)
  }

  const applySet = (
    item: Record<string, unknown>,
    assignment: string,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): void => {
    const set = /^(#?[\w.]+)\s*=\s*(.+)$/.exec(assignment)
    if (!set) throw new Error(`[rehearsal] unsupported SET: ${assignment}`)
    const attr = attrName(set[1]!, names)
    const rhs = set[2]!.trim()

    const increment = /^if_not_exists\(\s*(#?[\w.]+)\s*,\s*(:\w+)\s*\)\s*\+\s*(:\w+)$/.exec(rhs)
    if (increment) {
      const base = item[attrName(increment[1]!, names)] ?? values?.[increment[2]!]
      item[attr] = Number(base ?? 0) + Number(values?.[increment[3]!] ?? 0)
      return
    }
    const seed = /^if_not_exists\(\s*(#?[\w.]+)\s*,\s*(:\w+)\s*\)$/.exec(rhs)
    if (seed) {
      item[attr] = item[attrName(seed[1]!, names)] ?? values?.[seed[2]!]
      return
    }
    const literal = /^(:\w+)$/.exec(rhs)
    if (!literal) throw new Error(`[rehearsal] unsupported SET value: ${rhs}`)
    item[attr] = values?.[literal[1]!]
  }

  const applyAdd = (
    item: Record<string, unknown>,
    assignment: string,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): void => {
    const add = /^(#?[\w.]+)\s+(:\w+)$/.exec(assignment)
    if (!add) throw new Error(`[rehearsal] unsupported ADD: ${assignment}`)
    const attr = attrName(add[1]!, names)
    item[attr] = Number(item[attr] ?? 0) + Number(values?.[add[2]!] ?? 0)
  }

  const applyUpdate = (
    item: Record<string, unknown>,
    expression: string,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): void => {
    const parts = expression
      .split(/\b(SET|ADD|REMOVE)\b/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    for (let i = 0; i < parts.length; i += 2) {
      const operation = parts[i]!.toUpperCase()
      for (const assignment of splitAssignments(parts[i + 1] ?? '')) {
        if (operation === 'REMOVE') delete item[attrName(assignment, names)]
        else if (operation === 'ADD') applyAdd(item, assignment, names, values)
        else applySet(item, assignment, names, values)
      }
    }
  }

  const putItem = (input: Record<string, unknown>): void => {
    const table = String(input['TableName'] ?? '')
    const item = input['Item'] as Record<string, unknown>
    const key = rowKey(table, item)
    const condition = input['ConditionExpression'] as string | undefined
    if (
      condition &&
      !evaluate(
        tableOf(table).get(key) ?? {},
        condition,
        input['ExpressionAttributeNames'] as Record<string, string> | undefined,
        input['ExpressionAttributeValues'] as Record<string, unknown> | undefined,
      )
    ) {
      throw conditionalFailure()
    }
    tableOf(table).set(key, { ...item })
  }

  const updateItem = (input: Record<string, unknown>): Record<string, unknown> => {
    const table = String(input['TableName'] ?? '')
    const keyObj = input['Key'] as Record<string, unknown>
    const key = rowKey(table, keyObj)
    const names = input['ExpressionAttributeNames'] as Record<string, string> | undefined
    const values = input['ExpressionAttributeValues'] as Record<string, unknown> | undefined
    const existing = tableOf(table).get(key)
    const condition = input['ConditionExpression'] as string | undefined
    if (condition && !evaluate(existing ?? {}, condition, names, values)) throw conditionalFailure()
    const item = existing ?? { ...keyObj }
    applyUpdate(item, String(input['UpdateExpression']), names, values)
    tableOf(table).set(key, item)
    return item
  }

  const deleteItem = (input: Record<string, unknown>): void => {
    const table = String(input['TableName'] ?? '')
    tableOf(table).delete(rowKey(table, input['Key'] as Record<string, unknown>))
  }

  const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name
    const input = cmd.input ?? {}
    const table = String(input['TableName'] ?? '')
    const names = input['ExpressionAttributeNames'] as Record<string, string> | undefined
    const values = input['ExpressionAttributeValues'] as Record<string, unknown> | undefined

    if (name === 'GetCommand') {
      const item = tableOf(table).get(rowKey(table, input['Key'] as Record<string, unknown>))
      return item ? { Item: { ...item } } : {}
    }

    if (name === 'PutCommand') {
      putItem(input)
      return {}
    }

    if (name === 'DeleteCommand') {
      deleteItem(input)
      return {}
    }

    if (name === 'UpdateCommand') {
      return { Attributes: { ...updateItem(input) } }
    }

    if (name === 'TransactWriteCommand') {
      // Applied in order. Atomicity is not modelled: no act here depends on a
      // rollback, and every transaction in this feature writes a pair of rows
      // whose keys are derived from the same input.
      for (const entry of (input['TransactItems'] as Array<Record<string, Record<string, unknown>>>) ?? []) {
        if (entry['Put']) putItem(entry['Put'])
        else if (entry['Update']) updateItem(entry['Update'])
        else if (entry['Delete']) deleteItem(entry['Delete'])
        else throw new Error(`[rehearsal] unmodelled transaction item ${Object.keys(entry).join(',')}`)
      }
      return {}
    }

    if (name === 'QueryCommand' || name === 'ScanCommand') {
      const rows = [...tableOf(table).values()].filter(
        (item) =>
          evaluate(item, input['KeyConditionExpression'] as string | undefined, names, values) &&
          evaluate(item, input['FilterExpression'] as string | undefined, names, values),
      )
      const schema = keyAttrs(table)
      const sortAttr = schema[1] ?? schema[0]!
      rows.sort((a, b) => compareValues(a[sortAttr], b[sortAttr]))
      const ordered = input['ScanIndexForward'] === false ? rows.reverse() : rows
      const limit = input['Limit'] as number | undefined
      const page = limit ? ordered.slice(0, limit) : ordered
      if (input['Select'] === 'COUNT') return { Count: page.length, ScannedCount: page.length }
      return { Items: page.map((item) => ({ ...item })), Count: page.length }
    }

    if (name === 'BatchGetCommand') {
      const requestItems = input['RequestItems'] as Record<string, { Keys: Array<Record<string, unknown>> }>
      const responses: Record<string, Array<Record<string, unknown>>> = {}
      for (const [tableName, request] of Object.entries(requestItems)) {
        responses[tableName] = request.Keys.map((k) => tableOf(tableName).get(rowKey(tableName, k))).filter(
          (item): item is Record<string, unknown> => item !== undefined,
        )
      }
      return { Responses: responses }
    }

    throw new Error(`[rehearsal] unmodelled DynamoDB command ${name}`)
  })

  /** Every row in the table whose name ends with the given suffix. */
  const rowsIn = (suffix: string): Array<Record<string, unknown>> => {
    for (const [name, rows] of tables) {
      if (name.endsWith(suffix)) return [...rows.values()]
    }
    return []
  }

  /** Who is still in the room, per node. Backs the mocked presence reads. */
  const presenceCounts = new Map<string, number>()

  return {
    send,
    rowsIn,
    presenceCounts,
    seed: (table: string, item: Record<string, unknown>) => {
      tableOf(table).set(rowKey(table, item), item)
    },
    /** The app-data KV row behind a key, or undefined once it has been consumed. */
    kvRow: (key: string): Record<string, unknown> | undefined =>
      rowsIn('app-data').find((row) => row['pk'] === `KV#${key}`),
    // ─── Seams ───
    broadcastToRoom: vi.fn(async (_room: string, _message: { type: string; payload: unknown }) => 1),
    broadcastToUser: vi.fn(async (_userId: string, _message: { type: string; payload: unknown }) => 1),
    createOrRefreshPresence: vi.fn(async (params: { nodeId: string }) => {
      presenceCounts.set(params.nodeId, (presenceCounts.get(params.nodeId) ?? 0) + 1)
      return { opened: true }
    }),
    getLivePresenceCount: vi.fn(async (nodeId: string) => presenceCounts.get(nodeId) ?? 0),
    recordPresenceSample: vi.fn(async () => null),
    listRedemptionsForBusiness: vi.fn(async () => [] as Array<Record<string, unknown>>),
    getFollowingIds: vi.fn(async () => [] as string[]),
    getMutualFollowIds: vi.fn(async () => new Set<string>()),
    processCheckInRewardLocks: vi.fn(async () => undefined),
    recordMilestone: vi.fn(async () => undefined),
    streakMilestoneFor: vi.fn(() => null),
    sendNotification: vi.fn(async (_input: { userId: string; type: string; title: string; body: string }) => undefined),
    getPreferences: vi.fn(async () => ({})),
    listGuestClaimsSince: vi.fn(async () => [] as Array<Record<string, unknown>>),
    sendDigestEmail: vi.fn(
      async (_to: string, _venueName: string, _headlineVisits: number, _copyLines: string[]) => undefined,
    ),
    sendReportReadyEmail: vi.fn(async () => undefined),
    sendRenewalReminderEmail: vi.fn(async () => undefined),
    sendRenewalUpcomingEmail: vi.fn(async () => undefined),
    evaluateLiveArchetype: vi.fn(async () => ({ changed: false })),
  }
})

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.send } }
})

// Stand-in for the Cognito verifier: same contract (401 without an identity,
// `request.auth` on success, and the optional pair leaving an anonymous request
// alone) without reaching a JWKS endpoint.
vi.mock('../../../shared/middleware/auth.js', () => ({
  requireAuth: (..._roles: string[]) => {
    return async (request: { headers?: Record<string, string>; auth?: unknown }) => {
      const userId = request.headers?.['x-rehearsal-user']
      if (!userId) throw Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 })
      request.auth = { userId, role: 'consumer' }
    }
  },
  optionalAuth: (..._roles: string[]) => {
    return async (request: { headers?: Record<string, string>; auth?: unknown }) => {
      const userId = request.headers?.['x-rehearsal-user']
      if (userId) request.auth = { userId, role: 'consumer' }
    }
  },
  getAuth: (request: { auth?: { userId: string } }) => request.auth,
  getOptionalAuth: (request: { auth?: { userId: string } }) => request.auth ?? null,
}))

vi.mock('../../../shared/websocket/broadcast.js', () => ({
  broadcastToRoom: h.broadcastToRoom,
  broadcastToUser: h.broadcastToUser,
}))

vi.mock('../../presence/repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../presence/repository.js')>()
  return {
    ...actual,
    createOrRefreshPresence: h.createOrRefreshPresence,
    getLivePresenceCount: h.getLivePresenceCount,
    recordPresenceSample: h.recordPresenceSample,
  }
})

vi.mock('../../social/repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../social/repository.js')>()
  return { ...actual, getFollowingIds: h.getFollowingIds, getMutualFollowIds: h.getMutualFollowIds }
})

vi.mock('../../business/staff-leaderboard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../business/staff-leaderboard.js')>()
  return { ...actual, listRedemptionsForBusiness: h.listRedemptionsForBusiness }
})

vi.mock('../../rewards/threshold-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../rewards/threshold-lock.js')>()
  return { ...actual, processCheckInRewardLocks: h.processCheckInRewardLocks }
})

vi.mock('../../social/milestones.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../social/milestones.js')>()
  return { ...actual, recordMilestone: h.recordMilestone, streakMilestoneFor: h.streakMilestoneFor }
})

vi.mock('../../notifications/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../notifications/service.js')>()
  return { ...actual, sendNotification: h.sendNotification, getPreferences: h.getPreferences }
})

vi.mock('../../rewards/guest-claim.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../rewards/guest-claim.js')>()
  return { ...actual, listGuestClaimsSince: h.listGuestClaimsSince }
})

vi.mock('../../../shared/email/ses.js', () => ({
  sendDigestEmail: h.sendDigestEmail,
  sendReportReadyEmail: h.sendReportReadyEmail,
  sendRenewalReminderEmail: h.sendRenewalReminderEmail,
  sendRenewalUpcomingEmail: h.sendRenewalUpcomingEmail,
}))

vi.mock('../../../workers/live-archetype-evaluator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../workers/live-archetype-evaluator.js')>()
  return { ...actual, evaluateLiveArchetype: h.evaluateLiveArchetype }
})

// ─── The rehearsal clock ──────────────────────────────────────────────────────
//
// A Wednesday, after the last of the seed's fixed today-offsets (07:50 SAST) so
// no seeded row sits in the future, and inside a Digest_Week that opens after
// `RECEIPT_MEASURED_FROM_ISO` so no "measured from" annotation appears.

const MINUTE_MS = 60_000
/** 08:35 SAST: the share link is opened. */
const OPEN_AT_MS = Date.parse('2026-10-14T06:35:00.000Z')
/** 09:00 SAST: 25 minutes later, clear of the Away_Gate time arm. */
const CHECK_IN_AT_MS = OPEN_AT_MS + (AWAY_GATE_MIN_MINUTES + 5) * MINUTE_MS
/** 09:05 SAST: the Going mark and everything the same day reads. */
const GOING_AT_MS = CHECK_IN_AT_MS + 5 * MINUTE_MS
/** 18:00 SAST: the seeded Dated_Slot starts and the reminder fires. */
const TONIGHT_START_MS = Date.parse('2026-10-14T16:00:00.000Z')
/** Monday 02:00 SAST: the next weekly pass, while the week's Going rows still live. */
const NEXT_MONDAY_PASS_MS = Date.parse('2026-10-19T00:00:00.000Z')

const QR_SECRET = 'rehearsal-qr-hmac-secret'
const KUDU = venueFor('kudu')
const THEMBI = venueFor('thembi')
const LOFT = venueFor('loft')
const T01 = SEED_TESTERS[0]!
const T02 = SEED_TESTERS[1]!
/** Loft's seeded Walk_In count, named so act 6 reads as a sentence. */
const LOFT_WALK_INS = SEED_ACTIVITY.find((activity) => activity.key === 'loft')!.weekWalkIns
const IP_A = '203.0.113.21'
const IP_B = '203.0.113.22'

let checkInRoutes: (typeof import('../../check-in/handler.js'))['checkInRoutes']
let nodeShareRoutes: (typeof import('../../nodes/share-routes.js'))['nodeShareRoutes']
let nodeRoutes: (typeof import('../../nodes/handler.js'))['nodeRoutes']
let venueOpenKey: (typeof import('../../check-in/venue-open.js'))['venueOpenKey']
let getLiveStats: (typeof import('../../business/service.js'))['getLiveStats']
let getBoostScoreboard: (typeof import('../../business/boost-scoreboard-read.js'))['getBoostScoreboard']
let putBoosterPurchaseWithMarker: (typeof import('../../business/repository.js'))['putBoosterPurchaseWithMarker']
let boostWindowEnd: (typeof import('../../business/types.js'))['boostWindowEnd']
let generateReportNow: (typeof import('../generator.js'))['generateReportNow']
let runTransitionTick: (typeof import('../../../workers/schedule-transition-tick.js'))['runTransitionTick']
let TableNames: (typeof import('../../../shared/db/dynamodb.js'))['TableNames']

// ─── Route harness ────────────────────────────────────────────────────────────

type Handler = (request: any, reply: any) => unknown | Promise<unknown>

interface CapturedRoute {
  method: string
  url: string
  opts: { preHandler?: Handler[] }
  handler: Handler
}

type Registrar = (app: FastifyInstance) => Promise<void>

async function routesOf(register: Registrar): Promise<CapturedRoute[]> {
  const routes: CapturedRoute[] = []
  const record =
    (method: string) =>
    (url: string, opts: { preHandler?: Handler[] }, handler: Handler): void => {
      routes.push({ method, url, opts, handler })
    }
  const app = {
    get: record('get'),
    post: record('post'),
    put: record('put'),
    patch: record('patch'),
    delete: record('delete'),
    addHook: () => undefined,
    register: async () => undefined,
  } as unknown as FastifyInstance
  await register(app)
  return routes
}

interface CallOptions {
  userId?: string
  ip?: string
  params?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
}

/** Run the real preHandler chain, then the handler, as Fastify would. */
async function call(
  register: Registrar,
  method: string,
  url: string,
  opts: CallOptions,
): Promise<{ result: unknown; statusCode?: number; payload?: unknown; headers: Record<string, string> }> {
  const routes = await routesOf(register)
  const route = routes.find((r) => r.method === method && r.url === url)
  if (!route) throw new Error(`route not registered: ${method.toUpperCase()} ${url}`)

  const state: { statusCode?: number; payload?: unknown } = {}
  const headers: Record<string, string> = {}
  const reply = {
    status(code: number) {
      state.statusCode = code
      return reply
    },
    type(value: string) {
      headers['content-type'] = value
      return reply
    },
    header(key: string, value: string) {
      headers[key.toLowerCase()] = value
      return reply
    },
    send(payload?: unknown) {
      state.payload = payload
      return reply
    },
  }
  const request = {
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body,
    ip: opts.ip ?? '203.0.113.1',
    headers: {
      ...(opts.userId ? { 'x-rehearsal-user': opts.userId, authorization: 'Bearer rehearsal' } : {}),
    } as Record<string, string>,
  }
  for (const pre of route.opts.preHandler ?? []) await pre(request, reply)
  const result = await route.handler(request, reply)
  return { result, statusCode: state.statusCode, payload: state.payload, headers }
}

/** The QR token the printed code carries at the current instant. */
function currentQrToken(nodeId: string): string {
  const ts = Math.floor(Date.now() / (15 * 60 * 1000))
  return createHmac('sha256', QR_SECRET).update(`${nodeId}${ts}`).digest('hex').slice(0, 32)
}

/** The stored check-in rows for a consumer, as the read models see them. */
function storedCheckIns(userId: string): Array<Record<string, unknown>> {
  return h.rowsIn('checkins').filter((row) => row['userId'] === userId)
}

/** Payloads of one business-room event type, in order. */
function businessPayloads(type: string): Array<Record<string, unknown>> {
  return h.broadcastToRoom.mock.calls
    .map(([, message]) => message as { type: string; payload: Record<string, unknown> })
    .filter((message) => message.type === type)
    .map((message) => message.payload)
}

/** The copy lines the Digest_Email was handed for one business. */
function digestCopyFor(businessName: string): string[] {
  const call = h.sendDigestEmail.mock.calls.find(([, venueName]) => venueName === businessName)
  if (!call) throw new Error(`no Digest_Email captured for ${businessName}`)
  return call[3]
}

// ─── The fixture: the task 12.1 dev seed ──────────────────────────────────────
//
// Derived from the seed's own pure plan and row builders, reduced to the
// attributes these read paths touch. Numbers and instants come from those
// modules, never restated here, so this harness and the figures in
// `docs/UAT_PROOF_OF_DEMAND.md` move together.

const DAY_MS = 24 * 60 * 60 * 1000

async function seedFixture(nowIso: string): Promise<void> {
  const { computePulse, dailyCheckInKvKey, pulseKvKey } = await import('../../nodes/pulse.js')
  const { presenceCounterKvKey } = await import('../../presence/repository.js')
  const { startOfSastDayIso, sastDateString } = await import('../../../shared/time/sast.js')
  const { DEFAULT_SCHEDULE_ID, upsertSchedule } = await import('../../music/schedule-repository.js')
  const { putGoing } = await import('../../nodes/going-repository.js')
  const { venueOpenKey: openKey, ATTRIBUTION_WINDOW_SECONDS } = await import('../../check-in/venue-open.js')

  const anchorMs = Date.parse(startOfSastDayIso(nowIso))
  const createdAt = new Date(anchorMs - 21 * DAY_MS).toISOString()
  const todaySastDate = sastDateString(nowIso)
  const offset = (days: number | null): string | null =>
    days === null ? null : new Date(anchorMs + days * DAY_MS).toISOString()

  const rows = buildCheckIns(nowIso)
  const perNode = new Map<string, number>()
  const perUser = new Map<string, number>()
  for (const row of rows) {
    perNode.set(row.nodeId, (perNode.get(row.nodeId) ?? 0) + 1)
    perUser.set(row.userId, (perUser.get(row.userId) ?? 0) + 1)
  }

  h.seed(TableNames.appData, {
    pk: `CITY#${SEED_CITY.cityId}`,
    sk: `CITY#${SEED_CITY.cityId}`,
    cityId: SEED_CITY.cityId,
    slug: SEED_CITY.slug,
    name: SEED_CITY.name,
  })

  for (const venue of SEED_VENUES) {
    h.seed(TableNames.businesses, {
      businessId: venue.businessId,
      id: venue.businessId,
      email: venue.email,
      businessName: venue.businessName,
      tier: venue.tier,
      trialEndsAt: offset(venue.trialDays),
      paidUntil: offset(venue.paidDays),
      paidInterval: venue.paidDays === null ? null : 'monthly',
      paymentGraceUntil: null,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    })
    h.seed(TableNames.nodes, {
      nodeId: venue.nodeId,
      id: venue.nodeId,
      name: venue.name,
      slug: venue.slug,
      category: venue.category,
      lat: venue.lat,
      lng: venue.lng,
      cityId: SEED_CITY.cityId,
      businessId: venue.businessId,
      claimStatus: 'claimed',
      isActive: true,
      isVerified: true,
      qrCheckinEnabled: true,
      boostUntil: offset(venue.boostDays),
      totalCheckIns: perNode.get(venue.nodeId) ?? 0,
      createdAt,
      updatedAt: createdAt,
    })
    h.seed(TableNames.rewards, {
      rewardId: venue.rewardId,
      nodeId: venue.nodeId,
      type: 'nth_checkin',
      title: venue.rewardTitle,
      description: 'Seeded get for the proof-of-demand rehearsal.',
      triggerValue: 1,
      claimedCount: 0,
      slotsLocked: false,
      isActive: true,
      getCategory: 'loyalty',
      repeatPolicy: 'once',
      createdAt,
      updatedAt: createdAt,
    })
  }

  for (const person of [...historyConsumers(), ...SEED_TESTERS]) {
    const totalCheckIns = perUser.get(person.userId) ?? 0
    h.seed(TableNames.users, {
      userId: person.userId,
      id: person.userId,
      username: person.username,
      displayName: person.displayName,
      email: person.email,
      emailVerified: true,
      cityId: SEED_CITY.cityId,
      tier: getTier(totalCheckIns),
      totalCheckIns,
      streakCount: 0,
      privacyLevel: 'public',
      onboardingComplete: true,
      isDisabled: false,
      createdAt,
      updatedAt: createdAt,
    })
    if (person.tonightReminder) {
      h.seed(TableNames.appData, {
        pk: `NOTIF_PREFS#${person.userId}`,
        sk: `NOTIF_PREFS#${person.userId}`,
        userId: person.userId,
        tonightReminder: true,
        updatedAt: createdAt,
      })
    }
  }

  for (const row of rows) {
    const venue = venueFor(row.venueKey)
    h.seed(TableNames.checkins, {
      checkInId: row.checkInId,
      timestamp: row.timestamp,
      userId: row.userId,
      nodeId: row.nodeId,
      type: 'reward',
      checkedInAt: row.checkedInAt,
      foundVia: row.foundVia,
    })
    h.seed(TableNames.appData, {
      pk: `BIZ_CHECKIN#${venue.businessId}#${checkInSastDate(row)}`,
      sk: `CHECKIN#${String(row.timestamp)}#${row.checkInId}`,
      displayName: null,
      tier: 'local',
      visitCount: row.visitCount,
      nodeId: row.nodeId,
      nodeName: venue.name,
      timestamp: row.checkedInAt,
      foundVia: row.foundVia,
    })
  }

  for (const open of buildVenueOpens(nowIso)) {
    h.seed(TableNames.appData, {
      pk: `KV#${openKey(open.userId, open.nodeId)}`,
      sk: 'VALUE',
      value: JSON.stringify({ source: open.source, openedAt: open.openedAt, away: open.away }),
      ttl: Math.floor(Date.parse(nowIso) / 1000) + ATTRIBUTION_WINDOW_SECONDS,
      updatedAt: nowIso,
    })
  }

  for (const record of buildPresence()) {
    h.presenceCounts.set(record.nodeId, (h.presenceCounts.get(record.nodeId) ?? 0) + 1)
  }

  const kvNumber = (key: string, value: number): void => {
    h.seed(TableNames.appData, { pk: `KV#${key}`, sk: 'VALUE', value, updatedAt: nowIso })
  }
  for (const activity of SEED_ACTIVITY) {
    const venue = venueFor(activity.key)
    const daily = rows.filter((r) => r.nodeId === venue.nodeId && checkInSastDate(r) === todaySastDate).length
    const live = activity.presentRefs.length
    kvNumber(presenceCounterKvKey(venue.nodeId), live)
    kvNumber(dailyCheckInKvKey(venue.nodeId), daily)
    kvNumber(pulseKvKey(SEED_CITY.cityId, venue.nodeId), computePulse(daily, live))
  }

  for (const venue of SEED_VENUES) {
    await upsertSchedule({
      businessId: venue.businessId,
      scheduleId: DEFAULT_SCHEDULE_ID,
      timezone: 'Africa/Johannesburg',
      slots: [buildTonightSlot(venue, nowIso)],
      updatedAt: nowIso,
      schemaVersion: 1,
    })
  }

  for (const mark of buildGoingMarks(nowIso)) {
    await putGoing(mark, nowIso)
  }
}

beforeAll(async () => {
  // Live read paths (DEV_MODE off) while the config guards take the dev branch.
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  process.env['AREA_CODE_QR_HMAC_SECRET'] = QR_SECRET
  // The UAT environment runs `shadow` (decision 8): enforcement is the legacy
  // flat 500 m radius, identical to prod, with divergence logged only.
  process.env['CHECKIN_PROXIMITY_MODE'] = 'shadow'
  ;({ checkInRoutes } = await import('../../check-in/handler.js'))
  ;({ nodeShareRoutes } = await import('../../nodes/share-routes.js'))
  ;({ nodeRoutes } = await import('../../nodes/handler.js'))
  ;({ venueOpenKey } = await import('../../check-in/venue-open.js'))
  ;({ getLiveStats } = await import('../../business/service.js'))
  ;({ getBoostScoreboard } = await import('../../business/boost-scoreboard-read.js'))
  ;({ putBoosterPurchaseWithMarker } = await import('../../business/repository.js'))
  ;({ boostWindowEnd } = await import('../../business/types.js'))
  ;({ generateReportNow } = await import('../generator.js'))
  ;({ runTransitionTick } = await import('../../../workers/schedule-transition-tick.js'))
  ;({ TableNames } = await import('../../../shared/db/dynamodb.js'))

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(OPEN_AT_MS)
  await seedFixture(new Date(OPEN_AT_MS).toISOString())
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
  delete process.env['AREA_CODE_QR_HMAC_SECRET']
  delete process.env['CHECKIN_PROXIMITY_MODE']
  vi.useRealTimers()
})

// ─── The rehearsal ────────────────────────────────────────────────────────────

describe('Proof of demand: end-to-end dev rehearsal (R13.2, R13.6)', () => {
  // ── Act 1: the share link ───────────────────────────────────────────────────

  it('act 1: the share link previews the venue and the arrival is recorded as a share open', async () => {
    const preview = await call(nodeShareRoutes, 'get', '/v1/share/node/:slug', {
      params: { slug: KUDU.slug },
      ip: IP_A,
    })

    const html = String(preview.payload)
    expect(preview.headers['content-type']).toContain('text/html')
    expect(preview.headers['cache-control']).toContain('max-age=300')
    // The snapshot leads with aliveness and taste, never distance
    // (`discovery-dna-vibe-over-convenience.md`): pulse label, who is there now,
    // then the owner's line for tonight, then the get.
    expect(html).toContain(
      `${KUDU.name} \u00b7 Active \u00b7 3 here now \u00b7 ${KUDU.headline} tonight from ${TONIGHT_START.time} \u00b7 1 get live`,
    )
    // Script-capable clients are redirected into the map with the source intact.
    expect(html).toContain(`/map?venue=${KUDU.slug}&amp;src=share`)

    // The consumer app records the arrival. Away: the tester opened the link at
    // home, more than `AWAY_DISTANCE_METRES` from the door.
    await call(checkInRoutes, 'post', '/v1/nodes/:nodeId/open', {
      userId: T01.userId,
      ip: IP_A,
      params: { nodeId: KUDU.nodeId },
      body: { source: 'share', away: true },
    })

    const openRow = h.kvRow(venueOpenKey(T01.userId, KUDU.nodeId))
    expect(openRow).toBeDefined()
    expect(JSON.parse(String(openRow!['value']))).toMatchObject({ source: 'share', away: true })
  })

  // ── Act 2: Found_You and Walk_In ────────────────────────────────────────────

  it('act 2: the share arrival becomes a Found_You check-in and a cold QR scan a Walk_In', async () => {
    vi.setSystemTime(CHECK_IN_AT_MS)

    const found = await call(checkInRoutes, 'post', '/v1/check-in', {
      userId: T01.userId,
      ip: IP_A,
      body: { nodeId: KUDU.nodeId, type: 'presence', lat: KUDU.lat, lng: KUDU.lng, accuracy: 25 },
    })
    expect(found.result).toMatchObject({ success: true })
    expect(storedCheckIns(T01.userId).map((row) => row['foundVia'])).toEqual(['share'])
    // The open is consumed, so one look earns credit once (R3.3).
    expect(h.kvRow(venueOpenKey(T01.userId, KUDU.nodeId))).toBeUndefined()

    const walkIn = await call(checkInRoutes, 'post', '/v1/check-in', {
      userId: T02.userId,
      ip: IP_B,
      body: { nodeId: KUDU.nodeId, type: 'presence', qrToken: currentQrToken(KUDU.nodeId) },
    })
    expect(walkIn.result).toMatchObject({ success: true })
    expect(storedCheckIns(T02.userId).map((row) => row['foundVia'])).toEqual(['walk_in'])
    expect(h.kvRow(venueOpenKey(T02.userId, KUDU.nodeId))).toBeUndefined()

    // Live, not only on poll: the fan-out carries both stamps (R3.6, R4.3).
    expect(businessPayloads('business:checkin').map((payload) => payload['foundVia'])).toEqual(['share', 'walk_in'])
  })

  // ── Act 3: Going ────────────────────────────────────────────────────────────

  it('act 3: a Going mark with a reminder opt-in moves the count and tells the owner', async () => {
    vi.setSystemTime(GOING_AT_MS)
    h.broadcastToRoom.mockClear()

    const seededMarks = SEED_ACTIVITY.find((activity) => activity.key === 'kudu')!.goingRefs.length
    // Through the real route, so the param gate, the body validation and the rate
    // limit a tester meets are all exercised on a seeded venue.
    const response = await call(nodeRoutes, 'post', '/v1/nodes/:nodeId/going', {
      userId: T01.userId,
      ip: IP_A,
      params: { nodeId: KUDU.nodeId },
      body: { remind: true },
    })
    const marked = response.result as { viewerGoing: boolean; goingCount: number }

    expect(marked.viewerGoing).toBe(true)
    expect(marked.goingCount).toBe(seededMarks + 1)
    // Above the threshold, so the count is shown on the venue card (R9.2).
    expect(marked.goingCount).toBeGreaterThanOrEqual(GOING_PUBLIC_THRESHOLD)

    // Aggregate only: the count and the night, never who marked (R9.5, R11.3).
    const going = businessPayloads('business:going')
    expect(going).toHaveLength(1)
    expect(going[0]).toMatchObject({ nodeId: KUDU.nodeId, goingCount: seededMarks + 1 })
    expect(JSON.stringify(going[0])).not.toContain(T01.userId)
  })

  // ── Act 4: the live panel ───────────────────────────────────────────────────

  it('act 4: the live panel reports the four counts and the two Receipt sentences', async () => {
    const seeded = SEED_ACTIVITY.find((activity) => activity.key === 'kudu')!
    const seededToday = seeded.today
    const expectedCheckIns = seededToday.length + 2
    const expectedFoundYou = seededToday.filter((entry) => entry.foundVia !== 'walk_in').length + 1
    const expectedWalkIns = seededToday.filter((entry) => entry.foundVia === 'walk_in').length + 1

    const stats = await getLiveStats(KUDU.businessId)

    expect(stats.checkInsToday).toBe(expectedCheckIns)
    expect(stats.foundYouToday).toBe(expectedFoundYou)
    expect(stats.walkInsToday).toBe(expectedWalkIns)
    // Conservation: every consumer sits on exactly one side of the Receipt.
    expect(stats.foundYouToday + stats.walkInsToday).toBe(expectedCheckIns)
    expect(stats.goingTonight).toEqual([
      { nodeId: KUDU.nodeId, nodeName: KUDU.name, goingCount: seeded.goingRefs.length + 1 },
    ])

    expect(stats.receiptToday.headline).toBe(`${expectedFoundYou} people found you on Area Code and checked in today.`)
    expect(stats.receiptToday.walkIn).toBe(`${expectedWalkIns} people who were already in the room also checked in.`)
  })

  // ── Act 5: the boost scoreboard ─────────────────────────────────────────────

  it('act 5: a boost purchase produces a scoreboard, and a closed window is cached not recomputed', async () => {
    // The dev checkout, minus Yoco: the same two rows the webhook writes, through
    // the same idempotency choreography. The seed deliberately leaves no purchase
    // row, so this is the rehearsal's own.
    const boostId = 'seed-pod-boost-kudu'
    const paidAt = new Date(Date.parse('2026-10-13T22:00:00.000Z') + 60 * MINUTE_MS).toISOString()
    const boostPk = `BOOST#${KUDU.businessId}`
    const boostSk = `PAID#${paidAt}#${boostId}`

    const written = await putBoosterPurchaseWithMarker({
      purchase: {
        pk: boostPk,
        sk: boostSk,
        gsi1pk: 'BOOST_BY_TIME',
        gsi1sk: paidAt,
        businessId: KUDU.businessId,
        nodeId: KUDU.nodeId,
        duration: '2hr',
        amountCents: 9900,
        currency: 'ZAR',
        yocoCheckoutId: boostId,
        paidAt,
        tierSnapshot: 'growth',
        neighbourhoodIdSnapshot: null,
        floorAtPurchaseCents: 9900,
        createdAt: paidAt,
      },
      marker: {
        pk: `BOOST_CHECKOUT#${boostId}`,
        sk: `BOOST_CHECKOUT#${boostId}`,
        businessId: KUDU.businessId,
        boostPk,
        boostSk,
        createdAt: paidAt,
      },
    })
    expect(written.result).toBe('written')

    const scoreboard = await getBoostScoreboard(KUDU.businessId, boostId, new Date().toISOString())
    const seededToday = SEED_ACTIVITY.find((activity) => activity.key === 'kudu')!.today

    expect(scoreboard.windowClosed).toBe(true)
    expect(scoreboard.window.windowEndUtc).toBe(boostWindowEnd(paidAt, '2hr'))
    // The whole of the seed's early-hours activity falls in the window.
    expect(scoreboard.window.checkIns).toBe(seededToday.length)
    expect(scoreboard.window.visitors).toBe(seededToday.length)
    expect(scoreboard.window.foundYou).toBe(seededToday.filter((entry) => entry.foundVia !== 'walk_in').length)
    expect(scoreboard.window.walkIns).toBe(seededToday.filter((entry) => entry.foundVia === 'walk_in').length)
    // The same clock window seven days earlier recorded nothing at this venue.
    expect(scoreboard.baseline.checkIns).toBe(0)
    // Below the Suppression_Floor, so the counts render and the comparison does
    // not (R7.3). Nothing here claims the boost did anything (R7.5).
    expect(seededToday.length).toBeLessThan(SUPPRESSION_FLOOR)
    expect(scoreboard.comparable).toBe(false)
    expect(scoreboard.delta).toBeNull()

    // Closed, so it is history: the second read is the stored copy, verbatim.
    expect(h.kvRow(`boost:score:${boostPk}:${boostSk}`)).toBeDefined()
    const reread = await getBoostScoreboard(KUDU.businessId, boostId, new Date().toISOString())
    expect(reread).toEqual(scoreboard)
  })

  // ── Act 6: the Monday digest over the seeded week ────────────────────────────

  it('act 6: the weekly pass produces the documented Receipt lines for all three branches', async () => {
    const week = closedDigestWeek(new Date().toISOString())
    // An instant strictly inside the closed week, as the dispatcher sends.
    const periodEnd = new Date(Date.parse(week.windowEndUtc) - 1).toISOString()

    for (const venue of SEED_VENUES) {
      await generateReportNow(venue.businessId, 'weekly', week.windowStartUtc, periodEnd)
    }

    const kudu = SEED_ACTIVITY.find((activity) => activity.key === 'kudu')!
    const kuduFoundYou = kudu.weekFoundVia.length
    const kuduFirstTimers = kuduFoundYou - kudu.returning
    const kuduCopy = digestCopyFor(KUDU.businessName)
    expect(kuduCopy.slice(0, 4)).toEqual([
      `${kuduFoundYou} people found you on Area Code and checked in this week.`,
      `${kudu.weekWalkIns} people who were already in the room also checked in.`,
      `${kuduFirstTimers} of them had never been in before.`,
      'Recorded sources: 5 from the map, 2 from a shared link, 1 from search, 1 from a notification.',
    ])
    // The R13.6 ship gate: the headline is at least 9 at one venue.
    expect(kuduFoundYou).toBeGreaterThanOrEqual(9)

    // Thembi: measured, but the sample is below the Suppression_Floor, so the
    // derived clauses are withheld rather than rendered at low confidence (R4.8).
    const thembi = SEED_ACTIVITY.find((activity) => activity.key === 'thembi')!
    const thembiCopy = digestCopyFor(THEMBI.businessName)
    expect(thembiCopy.slice(0, 2)).toEqual([
      `${thembi.weekFoundVia.length} people found you on Area Code and checked in this week.`,
      `${thembi.weekWalkIns} people who were already in the room also checked in.`,
    ])
    expect(thembi.weekFoundVia.length).toBeLessThan(SUPPRESSION_FLOOR)
    expect(thembiCopy.some((line) => line.includes('had never been in before'))).toBe(false)
    expect(thembiCopy.some((line) => line.startsWith('Recorded sources:'))).toBe(false)

    // Loft: the zero-Found_You branch. One next step, no blame, no padded number.
    // The digest reads no Onboarding_Checklist, so the step is the reach pair.
    const loftCopy = digestCopyFor(LOFT.businessName)
    expect(loftCopy.slice(0, 3)).toEqual([
      'No one has found you on Area Code and checked in this week yet.',
      `${LOFT_WALK_INS} people who were already in the room also checked in.`,
      'Share your venue link with your regulars, and publish what is on tonight.',
    ])

    // Found_You is non-zero at two of the three venues: the other R13.5 gate.
    const withFoundYou = SEED_ACTIVITY.filter((activity) => activity.weekFoundVia.length > 0)
    expect(withFoundYou.length).toBeGreaterThanOrEqual(2)

    // No causal verb anywhere in the owner-facing copy (R10.3).
    for (const line of [...kuduCopy, ...thembiCopy, ...loftCopy]) {
      for (const verb of ['brought', 'drove', 'generated', 'boosted', 'revenue', 'ticket', 'spend']) {
        expect(line.toLowerCase()).not.toContain(verb)
      }
    }
  })

  // ── Act 7: the Tonight_Reminder ─────────────────────────────────────────────

  it('act 7: the transition tick delivers the reminder at slot start, once per row', async () => {
    vi.setSystemTime(TONIGHT_START_MS)
    h.sendNotification.mockClear()

    const first = await runTransitionTick(TONIGHT_START_MS)
    expect(first.tonightRemindersSent).toBe(1)
    expect(h.sendNotification).toHaveBeenCalledTimes(1)

    const notification = h.sendNotification.mock.calls[0]![0]
    expect(notification.userId).toBe(T01.userId)
    expect(notification.type).toBe('tonight_reminder')
    expect(notification.title).toBe(`Tonight at ${KUDU.name}`)
    // Present tense about the room, never a claim about anybody's movement (R9.3).
    expect(notification.body).toBe(`${KUDU.headline} is starting now at ${KUDU.name}.`)
    for (const banned of ['coming', 'will arrive']) {
      expect(notification.body.toLowerCase()).not.toContain(banned)
    }

    // The row was claimed before the send, so a second tick over the same window
    // cannot put a second notification on the same phone (R9.7).
    h.sendNotification.mockClear()
    const second = await runTransitionTick(TONIGHT_START_MS)
    expect(second.tonightRemindersSent).toBe(0)
    expect(h.sendNotification).not.toHaveBeenCalled()
  })

  // ── Act 8: the Monday digest over the rehearsal week ────────────────────────

  it('act 8: the following Monday the digest carries the Going line as intent', async () => {
    vi.setSystemTime(NEXT_MONDAY_PASS_MS)
    h.sendDigestEmail.mockClear()

    const { digestWeekFor } = await import('../digest.js')
    // The week that just closed, the one the rehearsal night sits in.
    const week = digestWeekFor(new Date(NEXT_MONDAY_PASS_MS - DAY_MS).toISOString())
    const periodEnd = new Date(Date.parse(week.windowEndUtc) - 1).toISOString()

    await generateReportNow(KUDU.businessId, 'weekly', week.windowStartUtc, periodEnd)

    const copy = digestCopyFor(KUDU.businessName)
    const marks = SEED_ACTIVITY.find((activity) => activity.key === 'kudu')!.goingRefs.length + 1
    // Marks minus the seeded ones, whose own visits fall on the previous Going
    // night (the seed's early-hours rows sit before the 04:00 SAST rollover), so
    // the measured overlap is the rehearsal tester alone.
    expect(copy).toContain(`${marks} marked going before doors, 1 of them checked in.`)
    expect(marks).toBeGreaterThanOrEqual(SUPPRESSION_FLOOR)

    // Intent, never arrivals: the line reports an overlap, not a forecast.
    const goingLine = copy.find((line) => line.includes('marked going before doors'))!
    for (const banned of ['coming', 'will arrive', 'brought', 'drove', 'generated']) {
      expect(goingLine.toLowerCase()).not.toContain(banned)
    }
  })
})
