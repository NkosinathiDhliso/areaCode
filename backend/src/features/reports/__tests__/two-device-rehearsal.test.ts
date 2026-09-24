/**
 * Two-device dev rehearsal for the Receipt split (proof-of-demand task 3.8).
 *
 * **Validates: Requirements 3.1, 3.2, 4.3**
 *
 * ─── What this stands in for ─────────────────────────────────────────────────
 *
 * Task 3.8 is "two phones": one consumer opens a venue from the map while away
 * from it and checks in later (Found_You), a second consumer scans the QR at the
 * till with no prior open (Walk_In), and the owner's live panel moves on both
 * sides. Real handsets cannot run inside the automated suite, so this file is the
 * durable, replayable evidence for that rehearsal, and
 * `docs/UAT_PROOF_OF_DEMAND.md` carries the script a human runs on real devices.
 *
 * Modelled on `digest-pipeline-rehearsal.test.ts`: the REAL modules are wired
 * together over one in-memory DynamoDB, so the row the check-in pipeline writes
 * is the exact row the owner's live panel reads back.
 *
 *   1. Device A records a Venue_Open through `POST /v1/nodes/:nodeId/open`
 *      (`source: 'map'`, `away: true`), stored as `{ source, openedAt, away }`
 *      with an Attribution_Window TTL.
 *   2. More than `AWAY_GATE_MIN_MINUTES` later, Device A checks in by GPS at the
 *      venue. The Away_Gate passes on the time arm, so the stored check-in reads
 *      `foundVia: 'map'`.
 *   3. The Venue_Open row is consumed, so one open earns credit once (R3.3).
 *   4. Device B checks in cold by QR with no Venue_Open row at all. The stamp is
 *      `walk_in` by construction (R3.1), and no open row is ever written for it.
 *   5. `getLiveStats` reports `foundYouToday = 1` and `walkInsToday = 1` from
 *      those same two rows, and the two Receipt sentences name both sides.
 *   6. The `business:checkin` fan-out carries `foundVia` on both check-ins, so
 *      the panel splits live as well as on poll (R3.6, R4.3).
 *
 * ─── Fidelity: what is real vs mocked ────────────────────────────────────────
 *
 * REAL (exercised end to end):
 *   - both HTTP routes with their production preHandler chains: Zod validation
 *     and the DynamoDB sliding-window rate limiter;
 *   - the Venue_Open service (`recordVenueOpen`, merge, TTL) and the KV store it
 *     writes through;
 *   - the Away_Gate (`resolveFoundVia`) and the check-in service that stamps it;
 *   - the check-in repository and `createCheckIn`, so `foundVia` is persisted;
 *   - QR token validation (real HMAC over the real secret accessor);
 *   - the business live-stats repository read, `computeReceipt` and
 *     `buildReceiptCopy`;
 *   - the socket emitters and the privacy guard's business allowlist.
 *
 * MOCKED (environment seams, not domain logic):
 *   - DynamoDB (`documentClient.send`), backed by an in-memory store;
 *   - the Cognito verifier (`requireAuth`), so a request carries an identity
 *     without a JWKS round trip;
 *   - the WebSocket transport (`broadcastToRoom` / `broadcastToUser`), so the
 *     fan-out is observable;
 *   - presence, redemption, social, threshold-lock, milestone and notification
 *     reads the check-in path fans out to.
 *
 * ─── What a human must still verify on real devices ──────────────────────────
 *
 * Out of scope here, and therefore still outstanding as a manual pass (the
 * script is in `docs/UAT_PROOF_OF_DEMAND.md`):
 *   - a real phone's position producing `away: true` at open time, and the
 *     consumer app firing the open on arrival / detail mount;
 *   - a real camera scanning the printed QR;
 *   - the owner's live panel re-rendering both counts on the socket event.
 *
 * Runs under the standard `pnpm test` (default node env), never gated on
 * DEV_MODE.
 */

import { createHmac } from 'node:crypto'

import { ATTRIBUTION_WINDOW_HOURS, AWAY_GATE_MIN_MINUTES } from '@area-code/shared/constants/attribution'
import type { FastifyInstance } from 'fastify'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// ─── In-memory DynamoDB and the environment seams (vi.hoisted) ────────────────

const h = vi.hoisted(() => {
  // One store behind every table, so the check-in write and the live-panel read
  // share a single source of truth. Keys mirror the real table key schemas.
  const tables = new Map<string, Map<string, Record<string, unknown>>>()

  const keyAttrs = (table: string): string[] => {
    if (table.endsWith('app-data')) return ['pk', 'sk']
    if (table.endsWith('users')) return ['userId']
    if (table.endsWith('nodes')) return ['nodeId']
    if (table.endsWith('checkins')) return ['checkInId', 'timestamp']
    if (table.endsWith('businesses')) return ['businessId']
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

  /** Evaluate a key condition or filter: ANDed comparisons plus begins_with. */
  const matches = (
    item: Record<string, unknown>,
    expression: string | undefined,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): boolean => {
    if (!expression) return true
    return expression.split(/\s+AND\s+/i).every((raw) => {
      const clause = raw.trim().replace(/^\(/, '').replace(/\)$/, '')
      const begins = /^begins_with\(\s*(#?\w+)\s*,\s*(:\w+)\s*\)$/.exec(clause)
      if (begins) {
        const actual = item[attrName(begins[1]!, names)]
        return String(actual ?? '').startsWith(String(values?.[begins[2]!]))
      }
      const comparison = /^(#?\w+)\s*(>=|<=|<>|=|>|<)\s*(:\w+)$/.exec(clause)
      if (!comparison) throw new Error(`[rehearsal] unsupported condition: ${clause}`)
      const actual = item[attrName(comparison[1]!, names)]
      const expected = values?.[comparison[3]!]
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
    })
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

  /** Apply one `SET` assignment: a literal, an `if_not_exists` seed, or an increment. */
  const applySet = (
    item: Record<string, unknown>,
    assignment: string,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): void => {
    const set = /^(#?\w+)\s*=\s*(.+)$/.exec(assignment)
    if (!set) throw new Error(`[rehearsal] unsupported SET: ${assignment}`)
    const attr = attrName(set[1]!, names)
    const rhs = set[2]!.trim()

    const increment = /^if_not_exists\(\s*(#?\w+)\s*,\s*(:\w+)\s*\)\s*\+\s*(:\w+)$/.exec(rhs)
    if (increment) {
      const base = item[attrName(increment[1]!, names)] ?? values?.[increment[2]!]
      item[attr] = Number(base ?? 0) + Number(values?.[increment[3]!] ?? 0)
      return
    }
    const seed = /^if_not_exists\(\s*(#?\w+)\s*,\s*(:\w+)\s*\)$/.exec(rhs)
    if (seed) {
      item[attr] = item[attrName(seed[1]!, names)] ?? values?.[seed[2]!]
      return
    }
    const literal = /^(:\w+)$/.exec(rhs)
    if (!literal) throw new Error(`[rehearsal] unsupported SET value: ${rhs}`)
    item[attr] = values?.[literal[1]!]
  }

  /** Apply one `ADD` clause: the atomic numeric increment the counters use. */
  const applyAdd = (
    item: Record<string, unknown>,
    assignment: string,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): void => {
    const add = /^(#?\w+)\s+(:\w+)$/.exec(assignment)
    if (!add) throw new Error(`[rehearsal] unsupported ADD: ${assignment}`)
    const attr = attrName(add[1]!, names)
    item[attr] = Number(item[attr] ?? 0) + Number(values?.[add[2]!] ?? 0)
  }

  /** Apply the SET / ADD / REMOVE forms the production repositories actually use. */
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
      const item = input['Item'] as Record<string, unknown>
      const key = rowKey(table, item)
      const condition = String(input['ConditionExpression'] ?? '')
      if (condition.includes('attribute_not_exists(pk)') && tableOf(table).has(key)) {
        const err = new Error('The conditional request failed') as Error & { name: string }
        err.name = 'ConditionalCheckFailedException'
        throw err
      }
      tableOf(table).set(key, { ...item })
      return {}
    }

    if (name === 'DeleteCommand') {
      tableOf(table).delete(rowKey(table, input['Key'] as Record<string, unknown>))
      return {}
    }

    if (name === 'UpdateCommand') {
      const keyObj = input['Key'] as Record<string, unknown>
      const key = rowKey(table, keyObj)
      const item = tableOf(table).get(key) ?? { ...keyObj }
      applyUpdate(item, String(input['UpdateExpression']), names, values)
      tableOf(table).set(key, item)
      return { Attributes: { ...item } }
    }

    if (name === 'QueryCommand') {
      const rows = [...tableOf(table).values()].filter(
        (item) =>
          matches(item, input['KeyConditionExpression'] as string | undefined, names, values) &&
          matches(item, input['FilterExpression'] as string | undefined, names, values),
      )
      // Sort on the range key (or the partition key for single-key tables), then
      // honour ScanIndexForward, as DynamoDB does.
      const schema = keyAttrs(table)
      const sortAttr = schema[1] ?? schema[0]!
      rows.sort((a, b) => compareValues(a[sortAttr], b[sortAttr]))
      const ordered = input['ScanIndexForward'] === false ? rows.reverse() : rows
      const limit = input['Limit'] as number | undefined
      const page = limit ? ordered.slice(0, limit) : ordered
      if (input['Select'] === 'COUNT') return { Count: page.length, ScannedCount: page.length }
      return { Items: page.map((item) => ({ ...item })), Count: page.length }
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

  return {
    tables,
    send,
    rowsIn,
    seed: (table: string, item: Record<string, unknown>) => {
      tableOf(table).set(rowKey(table, item), item)
    },
    reset: () => tables.clear(),
    /** The app-data KV row behind a key, or undefined once it has been consumed. */
    kvRow: (key: string): Record<string, unknown> | undefined =>
      rowsIn('app-data').find((row) => row['pk'] === `KV#${key}`),
    // ─── Seams ───
    broadcastToRoom: vi.fn(async (_room: string, _message: { type: string; payload: unknown }) => 1),
    broadcastToUser: vi.fn(async (_userId: string, _message: { type: string; payload: unknown }) => 1),
    createOrRefreshPresence: vi.fn(async () => ({ opened: true })),
    getLivePresenceCount: vi.fn(async () => 1),
    recordPresenceSample: vi.fn(async () => null),
    listRedemptionsForBusiness: vi.fn(async () => [] as Array<Record<string, unknown>>),
    getFollowingIds: vi.fn(async () => [] as string[]),
    getMutualFollowIds: vi.fn(async () => new Set<string>()),
    processCheckInRewardLocks: vi.fn(async () => undefined),
    recordMilestone: vi.fn(async () => undefined),
    streakMilestoneFor: vi.fn(() => null),
    sendNotification: vi.fn(async () => undefined),
    getPreferences: vi.fn(async () => ({})),
  }
})

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.send } }
})

// Stand-in for the Cognito verifier: same contract (401 without an identity,
// `request.auth` on success) without reaching a JWKS endpoint. Each device sends
// its own consumer id, which is what makes this a two-phone rehearsal.
vi.mock('../../../shared/middleware/auth.js', () => ({
  requireAuth: (..._roles: string[]) => {
    return async (request: { headers?: Record<string, string>; auth?: unknown }) => {
      const userId = request.headers?.['x-rehearsal-user']
      if (!userId) throw Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 })
      request.auth = { userId, role: 'consumer' }
    }
  },
  getAuth: (request: { auth?: { userId: string } }) => request.auth,
}))

// The WebSocket transport, so the real emitters run and the fan-out is observable.
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

// ─── Fixture: one paid venue, two consumers, two devices ─────────────────────

const BUSINESS_ID = 'biz-rehearsal-1'
const NODE_ID = 'node-rehearsal-a'
const CITY_ID = 'city-jhb'
const NODE_LAT = -26.1952
const NODE_LNG = 28.0341
const DEVICE_A = 'user-device-a'
const DEVICE_B = 'user-device-b'
const IP_A = '203.0.113.11'
const IP_B = '203.0.113.12'
const QR_SECRET = 'rehearsal-qr-hmac-secret'
const MINUTE_MS = 60_000

// A fixed instant after RECEIPT_MEASURED_FROM_ISO, so the Receipt covers the
// whole window and no "measured from" annotation appears. 18:00 SAST: inside one
// SAST day, with the later check-in still on the same day.
const OPEN_AT_MS = Date.parse('2026-10-14T16:00:00.000Z')
const CHECK_IN_AT_MS = OPEN_AT_MS + (AWAY_GATE_MIN_MINUTES + 5) * MINUTE_MS

let checkInRoutes: (typeof import('../../check-in/handler.js'))['checkInRoutes']
let venueOpenKey: (typeof import('../../check-in/venue-open.js'))['venueOpenKey']
let getLiveStats: (typeof import('../../business/service.js'))['getLiveStats']

// ─── Route harness (the two phones' HTTP calls) ───────────────────────────────

type Handler = (request: unknown, reply: unknown) => unknown | Promise<unknown>

interface CapturedRoute {
  url: string
  opts: { preHandler: Handler[] }
  handler: Handler
}

async function routeFor(url: string): Promise<CapturedRoute> {
  const routes: CapturedRoute[] = []
  const app = {
    post: (routeUrl: string, opts: { preHandler: Handler[] }, handler: Handler) => {
      routes.push({ url: routeUrl, opts, handler })
    },
  } as unknown as FastifyInstance
  await checkInRoutes(app)
  const route = routes.find((r) => r.url === url)
  if (!route) throw new Error(`route not registered: ${url}`)
  return route
}

/** Run the real preHandler chain, then the handler, as Fastify would. */
async function post(
  url: string,
  opts: { userId: string; ip: string; params?: Record<string, string>; body: unknown },
): Promise<unknown> {
  const route = await routeFor(url)
  const state: { statusCode?: number; body?: unknown } = {}
  const reply = {
    status(code: number) {
      state.statusCode = code
      return reply
    },
    send(body?: unknown) {
      state.body = body
      return reply
    },
  }
  const request = {
    params: opts.params ?? {},
    body: opts.body,
    ip: opts.ip,
    headers: { 'x-rehearsal-user': opts.userId, authorization: 'Bearer rehearsal' },
  }
  for (const pre of route.opts.preHandler) await pre(request, reply)
  return route.handler(request, reply)
}

/** The QR token the printed code carries at the current instant. */
function currentQrToken(): string {
  const ts = Math.floor(Date.now() / (15 * 60 * 1000))
  return createHmac('sha256', QR_SECRET).update(`${NODE_ID}${ts}`).digest('hex').slice(0, 32)
}

function seedVenueAndConsumers(): void {
  h.seed('area-code-dev-nodes', {
    nodeId: NODE_ID,
    name: "Ramona's",
    slug: 'ramonas',
    lat: NODE_LAT,
    lng: NODE_LNG,
    cityId: CITY_ID,
    qrCheckinEnabled: true,
    businessId: BUSINESS_ID,
  })
  h.seed('area-code-dev-app-data', {
    pk: `CITY#${CITY_ID}`,
    sk: `CITY#${CITY_ID}`,
    cityId: CITY_ID,
    slug: 'johannesburg',
  })
  for (const userId of [DEVICE_A, DEVICE_B]) {
    h.seed('area-code-dev-users', {
      userId,
      tier: 'local',
      totalCheckIns: 0,
      isDisabled: false,
      // Older than a day, so the new-account velocity branch is not the subject.
      createdAt: '2026-09-01T08:00:00.000Z',
    })
  }
}

/** The stored check-in rows for a consumer, as the read models see them. */
function storedCheckIns(userId: string): Array<Record<string, unknown>> {
  return h.rowsIn('checkins').filter((row) => row['userId'] === userId)
}

/** The `business:checkin` payloads that left the emitters, in order. */
function businessCheckinPayloads(): Array<Record<string, unknown>> {
  return h.broadcastToRoom.mock.calls
    .map(([, message]) => message as { type: string; payload: Record<string, unknown> })
    .filter((message) => message.type === 'business:checkin')
    .map((message) => message.payload)
}

beforeAll(async () => {
  // Live read paths (DEV_MODE off) while the config guards take the dev branch:
  // the check-in service, the rate limiter and `getLiveStats` all short-circuit
  // in DEV_MODE, and this rehearsal is about the production path.
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  process.env['AREA_CODE_QR_HMAC_SECRET'] = QR_SECRET
  // The UAT environment runs `shadow` (decision 8): enforcement is the legacy
  // flat 500 m radius, identical to prod, with divergence logged only.
  process.env['CHECKIN_PROXIMITY_MODE'] = 'shadow'
  ;({ checkInRoutes } = await import('../../check-in/handler.js'))
  ;({ venueOpenKey } = await import('../../check-in/venue-open.js'))
  ;({ getLiveStats } = await import('../../business/service.js'))
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
  delete process.env['AREA_CODE_QR_HMAC_SECRET']
  delete process.env['CHECKIN_PROXIMITY_MODE']
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.reset()
  seedVenueAndConsumers()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(OPEN_AT_MS)
})

// ─── The rehearsal ────────────────────────────────────────────────────────────

describe('Receipt split — two-device dev rehearsal (R3.1, R3.2, R4.3)', () => {
  it('moves both counts: phone A found you from the map, phone B walked in with the QR', async () => {
    // ── Device A: opens the venue from the map, away from it ──────────────────
    const openResponse = await post('/v1/nodes/:nodeId/open', {
      userId: DEVICE_A,
      ip: IP_A,
      params: { nodeId: NODE_ID },
      body: { source: 'map', away: true },
    })
    void openResponse

    const openRow = h.kvRow(venueOpenKey(DEVICE_A, NODE_ID))
    expect(openRow).toBeDefined()
    expect(JSON.parse(String(openRow!['value']))).toMatchObject({ source: 'map', away: true })
    // Expires on its own after the Attribution_Window: no sweeper, no new infra.
    expect(Number(openRow!['ttl']) - Math.floor(OPEN_AT_MS / 1000)).toBe(ATTRIBUTION_WINDOW_HOURS * 60 * 60)

    // ── Device A: travels and checks in, past the Away_Gate time arm ──────────
    vi.setSystemTime(CHECK_IN_AT_MS)
    const deviceAResult = await post('/v1/check-in', {
      userId: DEVICE_A,
      ip: IP_A,
      body: { nodeId: NODE_ID, type: 'presence', lat: NODE_LAT, lng: NODE_LNG, accuracy: 25 },
    })
    expect(deviceAResult).toMatchObject({ success: true })

    const deviceACheckIns = storedCheckIns(DEVICE_A)
    expect(deviceACheckIns).toHaveLength(1)
    expect(deviceACheckIns[0]!['foundVia']).toBe('map')

    // The row is consumed, so this open cannot credit a second visit (R3.3).
    expect(h.kvRow(venueOpenKey(DEVICE_A, NODE_ID))).toBeUndefined()

    // ── Device B: scans the printed QR cold, with no prior open ───────────────
    const deviceBResult = await post('/v1/check-in', {
      userId: DEVICE_B,
      ip: IP_B,
      body: { nodeId: NODE_ID, type: 'presence', qrToken: currentQrToken() },
    })
    expect(deviceBResult).toMatchObject({ success: true })

    const deviceBCheckIns = storedCheckIns(DEVICE_B)
    expect(deviceBCheckIns).toHaveLength(1)
    expect(deviceBCheckIns[0]!['foundVia']).toBe('walk_in')
    // Nothing was ever stored for phone B: a QR scan is a Walk_In by construction.
    expect(h.kvRow(venueOpenKey(DEVICE_B, NODE_ID))).toBeUndefined()

    // ── The owner's live panel, read from those same two rows ─────────────────
    const stats = await getLiveStats(BUSINESS_ID)

    expect(stats.checkInsToday).toBe(2)
    expect(stats.foundYouToday).toBe(1)
    expect(stats.walkInsToday).toBe(1)
    // Conservation: each consumer sits on exactly one side of the Receipt.
    expect(stats.foundYouToday + stats.walkInsToday).toBe(2)

    expect(stats.receiptToday.headline).toBe('1 person found you on Area Code and checked in today.')
    expect(stats.receiptToday.walkIn).toBe('1 person who was already in the room also checked in.')

    // ── And live, not only on poll: the fan-out carries both stamps (R3.6) ────
    expect(businessCheckinPayloads().map((payload) => payload['foundVia'])).toEqual(['map', 'walk_in'])
  })
})
