/**
 * Dev seed for the proof-of-demand rehearsal (spec task 12.1, R13.1).
 *
 * Writes three paid-tier businesses, their venues, gets and QR, a published
 * Tonight with a featured get, a closed Digest_Week of check-ins split across
 * `foundVia` sources and walk-ins, today's live layer, unconsumed Venue_Open rows
 * and Going marks either side of `GOING_PUBLIC_THRESHOLD`. What it contains lives
 * in `./seed-proof-of-demand-plan.ts`, the rows in `-rows.ts`, and the resulting
 * numbers in `docs/UAT_PROOF_OF_DEMAND.md`.
 *
 * DEV ONLY. `AREA_CODE_ENV` must be set explicitly and must not be `prod`, and no
 * target table name may look like a production table. The guards refuse rather
 * than warn: this writes check-ins, and a check-in an owner reads as demand must
 * never be synthetic in production (`honest-presence.md`).
 *
 * Honest by construction: every number it leaves behind is backed by a row it
 * wrote. The daily counter equals the seeded check-ins for the SAST day, the live
 * count equals the presence records, and pulse is `computePulse` over those two.
 *
 * Idempotent: every id is deterministic and every write addresses a fixed key, so
 * a re-run converges on the same rows instead of doubling them. Counters are SET
 * to the derived value, never incremented.
 *
 * Usage (from backend/, with dev AWS credentials and the eight table env vars set:
 * USERS_TABLE, NODES_TABLE, CHECKINS_TABLE, REWARDS_TABLE, BUSINESSES_TABLE,
 * APP_DATA_TABLE, MUSIC_SCHEDULES_TABLE, PRESENCE_TABLE):
 *   AREA_CODE_ENV=dev npm run seed:proof-of-demand -- --dry-run
 *   AREA_CODE_ENV=dev npm run seed:proof-of-demand
 */

import { getTier } from '@area-code/shared/constants/tier-levels'
import { PutCommand } from '@aws-sdk/lib-dynamodb'

import { venueOpenKey, ATTRIBUTION_WINDOW_SECONDS } from '../features/check-in/venue-open.js'
import { DEFAULT_SCHEDULE_ID, upsertSchedule } from '../features/music/schedule-repository.js'
import { invalidateCityPayload } from '../features/nodes/cache.js'
import { putGoing } from '../features/nodes/going-repository.js'
import { computePulse, dailyCheckInKvKey, pulseKvKey, PULSE_TTL_SECONDS } from '../features/nodes/pulse.js'
import { presenceCounterKvKey } from '../features/presence/repository.js'
import { expiryWindowSeconds } from '../features/presence/window.js'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { sastDateString, secondsUntilNextSastMidnight, startOfSastDayIso } from '../shared/time/sast.js'

import {
  historyConsumers,
  latestTodayOffsetMin,
  SEED_ACTIVITY,
  SEED_CITY,
  SEED_TESTERS,
  SEED_VENUES,
  venueFor,
  type SeedConsumer,
} from './seed-proof-of-demand-plan.js'
import {
  buildCheckIns,
  buildGoingMarks,
  buildPresence,
  buildTonightSlot,
  buildVenueOpens,
  checkInSastDate,
} from './seed-proof-of-demand-rows.js'

const DRY_RUN = process.argv.includes('--dry-run')
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS
/** How long a seeded presence record has been open. Long enough to read as dwell. */
const PRESENCE_OPEN_MINUTES = 30
const stats = { rows: 0 }

// ─── Guards ──────────────────────────────────────────────────────────────────
function refuse(reason: string): never {
  console.error(`[seed-pod] refusing to run: ${reason}`)
  process.exit(1)
}

/**
 * Fail closed before a single write. `AREA_CODE_ENV` has a dev default in
 * `shared/config/env.ts`, so it is read directly here: an unset var is a refusal,
 * not an assumption about which account the credentials point at.
 */
function assertDevEnvironment(): void {
  const env = process.env['AREA_CODE_ENV']
  if (!env) refuse('AREA_CODE_ENV is not set. Set it explicitly (dev) so the target environment is unambiguous.')
  if (env === 'prod' || env === 'production') refuse(`AREA_CODE_ENV is "${env}". This seed is dev only.`)

  const { users, nodes, checkins, rewards, businesses, appData, musicSchedules, presence } = TableNames
  const tables = [users, nodes, checkins, rewards, businesses, appData, musicSchedules, presence]
  const productionLooking = tables.filter((name) => /prod/i.test(name))
  if (productionLooking.length > 0) {
    refuse(`these table names look like production: ${productionLooking.join(', ')}`)
  }

  // Today's rows land on fixed SAST wall-clock minutes so their sort keys never
  // move between runs. Writing one in the future would report a visit that has
  // not happened, so the seed waits instead.
  const latestTodayMs = Date.parse(startOfSastDayIso()) + latestTodayOffsetMin() * MINUTE_MS
  if (Date.now() < latestTodayMs) {
    refuse(`today's seeded check-ins run to ${new Date(latestTodayMs).toISOString()}; run the seed after that instant.`)
  }
}

/**
 * Put one row. Every seeded key is deterministic, so an unconditional Put is the
 * idempotent operation here: a re-run replaces the row with the identical one.
 */
async function put(tableName: string, item: Record<string, unknown>): Promise<void> {
  stats.rows++
  if (DRY_RUN) return
  await documentClient.send(new PutCommand({ TableName: tableName, Item: item }))
}

/** Put a KV row in the shape `kvSet`/`kvIncr` store, with a numeric counter value. */
async function putKvNumber(key: string, value: number, ttlSeconds: number): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + ttlSeconds
  await put(TableNames.appData, { pk: `KV#${key}`, sk: 'VALUE', value, ttl, updatedAt: new Date().toISOString() })
}

// ─── Reference data ──────────────────────────────────────────────────────────
async function seedCity(): Promise<void> {
  await put(TableNames.appData, {
    pk: `CITY#${SEED_CITY.cityId}`,
    sk: `CITY#${SEED_CITY.cityId}`,
    cityId: SEED_CITY.cityId,
    slug: SEED_CITY.slug,
    name: SEED_CITY.name,
  })
}

/**
 * Businesses, venues and gets. Lifecycle dates anchor to SAST midnight rather than
 * to the moment of the run, so two runs on one day write the same windows.
 */
async function seedVenues(createdAt: string, checkInTotals: Map<string, number>): Promise<void> {
  const anchorMs = Date.parse(startOfSastDayIso())
  const offset = (days: number | null): string | null =>
    days === null ? null : new Date(anchorMs + days * DAY_MS).toISOString()

  for (const venue of SEED_VENUES) {
    await put(TableNames.businesses, {
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

    await put(TableNames.nodes, {
      nodeId: venue.nodeId,
      id: venue.nodeId,
      name: venue.name,
      slug: venue.slug,
      category: venue.category,
      lat: venue.lat,
      lng: venue.lng,
      cityId: SEED_CITY.cityId,
      businessId: venue.businessId,
      submittedBy: venue.businessId,
      claimStatus: 'claimed',
      isActive: true,
      isVerified: true,
      qrCheckinEnabled: true,
      nodeColour: 'default',
      boostUntil: offset(venue.boostDays),
      totalCheckIns: checkInTotals.get(venue.nodeId) ?? 0,
      createdAt,
      updatedAt: createdAt,
    })

    await put(TableNames.rewards, {
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
}

// ─── Consumers ───────────────────────────────────────────────────────────────
async function seedConsumers(createdAt: string, checkInsByUser: Map<string, number>): Promise<void> {
  const all: SeedConsumer[] = [...historyConsumers(), ...SEED_TESTERS]
  for (const person of all) {
    const totalCheckIns = checkInsByUser.get(person.userId) ?? 0
    await put(TableNames.users, {
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
      createdAt,
      updatedAt: createdAt,
    })

    // Only the two testers seeded with the opt-in get a preferences row, so
    // every other account keeps the real default (off).
    if (person.tonightReminder) {
      await put(TableNames.appData, {
        pk: `NOTIF_PREFS#${person.userId}`,
        sk: `NOTIF_PREFS#${person.userId}`,
        userId: person.userId,
        tonightReminder: true,
        updatedAt: createdAt,
      })
    }
  }
}

/**
 * The check-in rows plus the owner-facing cached row each one produces. That row
 * is keyed by the SAST calendar date (R15.8), through the same `sastDateString`
 * the check-in service uses, so the panel finds them on the day the owner looks.
 */
async function seedCheckIns(rows: ReturnType<typeof buildCheckIns>): Promise<void> {
  for (const row of rows) {
    const venue = venueFor(row.venueKey)
    await put(TableNames.checkins, {
      checkInId: row.checkInId,
      timestamp: row.timestamp,
      userId: row.userId,
      nodeId: row.nodeId,
      type: 'reward',
      checkedInAt: row.checkedInAt,
      foundVia: row.foundVia,
    })

    await put(TableNames.appData, {
      pk: `BIZ_CHECKIN#${venue.businessId}#${checkInSastDate(row)}`,
      sk: `CHECKIN#${String(row.timestamp)}#${row.checkInId}`,
      displayName: null,
      tier: 'local',
      visitCount: row.visitCount,
      nodeId: row.nodeId,
      nodeName: venue.name,
      timestamp: row.checkedInAt,
      foundVia: row.foundVia,
      ttl: Math.floor(row.timestamp / 1000) + 30 * 24 * 60 * 60,
    })
  }
}

// ─── Live layer ──────────────────────────────────────────────────────────────
/**
 * Unconsumed Venue_Open rows, on the real `venueOpenKey` with the real
 * Attribution_Window TTL, so they expire on their own exactly as a live one does.
 */
async function seedVenueOpens(nowIso: string): Promise<void> {
  for (const open of buildVenueOpens(nowIso)) {
    await put(TableNames.appData, {
      pk: `KV#${venueOpenKey(open.userId, open.nodeId)}`,
      sk: 'VALUE',
      value: JSON.stringify({ source: open.source, openedAt: open.openedAt, away: open.away }),
      ttl: Math.floor(Date.now() / 1000) + ATTRIBUTION_WINDOW_SECONDS,
      updatedAt: nowIso,
    })
  }
}

/**
 * Presence records for the consumers the seed says are still in the room, and the
 * cached counter SET to exactly that many. SET rather than incremented: the
 * counter caches a record-derived count, so a re-run converges on the truth.
 */
async function seedPresence(): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const checkedInAt = nowSeconds - PRESENCE_OPEN_MINUTES * 60
  const expiresAt = checkedInAt + expiryWindowSeconds(nowSeconds)
  const counts = new Map<string, number>()

  for (const record of buildPresence()) {
    await put(TableNames.presence, {
      userId: record.userId,
      nodeId: record.nodeId,
      presenceState: 'present',
      checkedInAt,
      expiresAt,
      ttl: expiresAt + 24 * 60 * 60,
    })
    counts.set(record.nodeId, (counts.get(record.nodeId) ?? 0) + 1)
  }

  for (const venue of SEED_VENUES) {
    const live = counts.get(venue.nodeId) ?? 0
    await putKvNumber(presenceCounterKvKey(venue.nodeId), live, expiryWindowSeconds(nowSeconds) + 24 * 60 * 60)
  }
}

/**
 * The day counter and the pulse score, both derived. The counter is the seeded
 * check-ins on the current SAST day, expiring at the next SAST midnight (R15.2) so
 * it can never cite a day that is over. Pulse is `computePulse` over that counter
 * and the live presence count, the formula check-in and check-out share, so no
 * venue is given a score it has not earned.
 */
async function seedPulse(rows: ReturnType<typeof buildCheckIns>, todaySastDate: string): Promise<void> {
  for (const activity of SEED_ACTIVITY) {
    const venue = venueFor(activity.key)
    const daily = rows.filter((r) => r.nodeId === venue.nodeId && checkInSastDate(r) === todaySastDate).length
    const live = activity.presentRefs.length
    await putKvNumber(dailyCheckInKvKey(venue.nodeId), daily, secondsUntilNextSastMidnight())
    await putKvNumber(pulseKvKey(SEED_CITY.cityId, venue.nodeId), computePulse(daily, live), PULSE_TTL_SECONDS)
  }
}

// ─── Tonight and Going ───────────────────────────────────────────────────────
/** Publish tonight's Dated_Slot through the real validating upsert. */
async function seedTonight(nowIso: string): Promise<void> {
  for (const venue of SEED_VENUES) {
    stats.rows++
    if (DRY_RUN) continue
    await upsertSchedule({
      businessId: venue.businessId,
      scheduleId: DEFAULT_SCHEDULE_ID,
      timezone: 'Africa/Johannesburg',
      slots: [buildTonightSlot(venue, nowIso)],
      updatedAt: nowIso,
      schemaVersion: 1,
    })
  }
}

/** Going marks through the real transactional write, so both rows always exist. */
async function seedGoing(nowIso: string): Promise<void> {
  for (const mark of buildGoingMarks(nowIso)) {
    stats.rows += 2
    if (DRY_RUN) continue
    await putGoing(mark, nowIso)
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  assertDevEnvironment()
  const nowIso = new Date().toISOString()
  const todaySastDate = sastDateString(nowIso)
  console.log(`[seed-pod] seeding ${TableNames.nodes} / ${TableNames.checkins}${DRY_RUN ? ' (dry run)' : ''}`)

  const rows = buildCheckIns(nowIso)
  const perNode = new Map<string, number>()
  const perUser = new Map<string, number>()
  for (const row of rows) {
    perNode.set(row.nodeId, (perNode.get(row.nodeId) ?? 0) + 1)
    perUser.set(row.userId, (perUser.get(row.userId) ?? 0) + 1)
  }

  // Businesses and venues exist before anything references them, and the city
  // payload cache is dropped last so the map's next read sees the finished seed.
  const createdAt = new Date(Date.parse(startOfSastDayIso(nowIso)) - 21 * DAY_MS).toISOString()
  await seedCity()
  await seedVenues(createdAt, perNode)
  await seedConsumers(createdAt, perUser)
  await seedCheckIns(rows)
  await seedVenueOpens(nowIso)
  await seedPresence()
  await seedPulse(rows, todaySastDate)
  await seedTonight(nowIso)
  await seedGoing(nowIso)
  if (!DRY_RUN) await invalidateCityPayload(SEED_CITY.slug)

  // Order: week Found_You, week Walk_In, today, live now, going tonight.
  for (const activity of SEED_ACTIVITY) {
    const venue = venueFor(activity.key)
    const today = rows.filter((r) => r.nodeId === venue.nodeId && checkInSastDate(r) === todaySastDate).length
    const counts = [activity.weekFoundVia.length, activity.weekWalkIns, today, activity.presentRefs.length]
    console.log(`[seed-pod] ${venue.name}: ${[...counts, activity.goingRefs.length].join(' / ')}`)
  }
  console.log(`[seed-pod] done. ${String(stats.rows)} rows ${DRY_RUN ? 'would be written' : 'written'}.`)
}

run().catch((err) => {
  console.error('[seed-pod] failed:', err)
  process.exit(1)
})
