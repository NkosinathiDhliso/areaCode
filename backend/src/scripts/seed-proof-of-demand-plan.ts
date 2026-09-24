/**
 * WHAT the dev seed for the proof-of-demand rehearsal contains (spec task 12.1,
 * R13.1): the three businesses, their venues and gets, the per-venue activity
 * profile, and the consumer accounts.
 *
 * Pure data and pure helpers. The rows that follow from this plan are derived in
 * `./seed-proof-of-demand-rows.ts`; the writer is `./seed-proof-of-demand.ts`.
 *
 * Every id is deterministic, which is what makes the seed idempotent (a re-run
 * addresses the same keys). Two shapes, for one reason:
 *
 * - ids the API addresses in a URL path (`nodeId`, `rewardId`) are UUIDs, because
 *   the routes validate them as UUIDs (`nodeIdParamsSchema`,
 *   `rewardIdParamsSchema`). They are derived with `seedUuid`, so they are still
 *   fixed and still recomputable from the prefix plus the venue key;
 * - every other id stays readable and prefixed `seed-pod-`, which tells a seeded
 *   row apart from a tester's real one at a glance.
 */

import { createHash } from 'node:crypto'

import type { FoundVia, OpenSource } from '@area-code/shared/constants/attribution'
import type { MusicGenre } from '@area-code/shared/types'

/** Prefix on every seeded id. One string, so cleanup and recognition are trivial. */
export const SEED_PREFIX = 'seed-pod'

/** A UUIDv5-shaped id: SHA-1 over the bytes, with the version and variant bits set. */
function uuidFromBytes(input: Buffer): string {
  const bytes = createHash('sha1').update(input).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

/** Namespace for every seeded UUID, derived from the prefix. No magic constant. */
const SEED_UUID_NAMESPACE = Buffer.from(uuidFromBytes(Buffer.from(SEED_PREFIX, 'utf8')).replace(/-/g, ''), 'hex')

/**
 * The deterministic UUID for one seeded entity, UUIDv5 over `kind:key` in the
 * seed's own namespace.
 *
 * The routes validate `nodeId` and `rewardId` as UUIDs, so a readable id makes
 * every venue detail, Going mark and redemption answer `400 Invalid UUID`. This
 * keeps the id a UUID without giving up the two properties the seed needs: it is
 * fixed across runs, so the seed stays idempotent, and it is recomputable from the
 * prefix and the venue key, so a seeded row is still identifiable.
 */
export function seedUuid(kind: string, key: string): string {
  return uuidFromBytes(Buffer.concat([SEED_UUID_NAMESPACE, Buffer.from(`${kind}:${key}`, 'utf8')]))
}

/** The one city the seed uses. `cityId` equals the slug, as the demo venues do. */
export const SEED_CITY = { cityId: 'johannesburg', slug: 'johannesburg', name: 'Johannesburg' } as const

// ─── Venues ──────────────────────────────────────────────────────────────────

/**
 * One seeded business, its venue, its get and its Tonight. `paidDays`,
 * `trialDays` and `boostDays` are offsets in days from SAST midnight today to
 * `paidUntil`, `trialEndsAt` and the node's `boostUntil`; null means the business
 * has no such window. All three tiers are paid, so all three venues join the map.
 */
export interface SeedVenue {
  key: string
  businessId: string
  businessName: string
  email: string
  tier: 'starter' | 'growth'
  paidDays: number | null
  trialDays: number | null
  boostDays: number | null
  /** UUID, from `seedUuid`: the consumer and staff routes validate it as one. */
  nodeId: string
  name: string
  slug: string
  category: string
  lat: number
  lng: number
  /** UUID, from `seedUuid`: the get routes validate it as one. */
  rewardId: string
  rewardTitle: string
  /** The owner's one line for tonight. Max 60 chars (R8.1). */
  headline: string
  genres: MusicGenre[]
}

export const SEED_VENUES: readonly SeedVenue[] = [
  {
    key: 'kudu',
    businessId: `${SEED_PREFIX}-biz-kudu`,
    businessName: 'Kudu Bar (seed)',
    email: 'kudu@seed.areacode.invalid',
    tier: 'growth',
    paidDays: 21,
    trialDays: null,
    boostDays: 3,
    nodeId: seedUuid('node', 'kudu'),
    name: 'Kudu Bar (seed)',
    slug: 'kudu-bar-seed',
    category: 'nightlife',
    lat: -26.1478,
    lng: 28.0436,
    rewardId: seedUuid('reward', 'kudu'),
    rewardTitle: 'Free welcome drink',
    headline: 'Amapiano all night, Kabza tribute set',
    genres: ['amapiano'],
  },
  {
    key: 'thembi',
    businessId: `${SEED_PREFIX}-biz-thembi`,
    businessName: 'Thembi Coffee (seed)',
    email: 'thembi@seed.areacode.invalid',
    tier: 'starter',
    paidDays: 9,
    trialDays: null,
    boostDays: null,
    nodeId: seedUuid('node', 'thembi'),
    name: 'Thembi Coffee (seed)',
    slug: 'thembi-coffee-seed',
    category: 'coffee',
    lat: -26.195,
    lng: 28.034,
    rewardId: seedUuid('reward', 'thembi'),
    rewardTitle: 'Second cup on us',
    headline: 'Deep house sundowners on the roof',
    genres: ['deep_house'],
  },
  {
    key: 'loft',
    businessId: `${SEED_PREFIX}-biz-loft`,
    businessName: 'Loft 46 (seed)',
    email: 'loft@seed.areacode.invalid',
    tier: 'starter',
    paidDays: null,
    trialDays: 3,
    boostDays: null,
    nodeId: seedUuid('node', 'loft'),
    name: 'Loft 46 (seed)',
    slug: 'loft-46-seed',
    category: 'nightlife',
    lat: -26.2041,
    lng: 28.0473,
    rewardId: seedUuid('reward', 'loft'),
    rewardTitle: 'Two-for-one on the first set',
    headline: 'Live jazz trio, two sets',
    genres: ['jazz'],
  },
]

export function venueFor(key: string): SeedVenue {
  const venue = SEED_VENUES.find((v) => v.key === key)
  if (!venue) throw new Error(`seed plan: no venue "${key}"`)
  return venue
}

// ─── Per-venue activity ──────────────────────────────────────────────────────

/** Today's check-in. `offsetMin` is minutes after 00:00 SAST, fixed so the sort key never moves. */
export interface TodayCheckIn {
  ref: string
  foundVia: FoundVia
  offsetMin: number
}

/**
 * What each venue is seeded with. The three profiles are deliberately different
 * so the rehearsal exercises all three Receipt branches in one run: a venue well
 * clear of the Suppression_Floor, one below it, and one with no Found_You at all.
 *
 * - `weekFoundVia`: one Open_Source per Found_You consumer in the closed week.
 * - `weekWalkIns`: consumers in that week with Walk_In check-ins only.
 * - `returning`: how many Found_You consumers also visited BEFORE the week, so
 *   `foundYouFirstTimers` is a real subset rather than the whole set.
 * - `presentRefs`: who is still in the room. Backs the live count.
 * - `goingRefs`: who marked Going for tonight.
 * - `openRefs`: who holds an UNCONSUMED Venue_Open (looked, has not arrived).
 */
export interface SeedActivity {
  key: string
  weekFoundVia: OpenSource[]
  weekWalkIns: number
  returning: number
  today: TodayCheckIn[]
  presentRefs: string[]
  goingRefs: string[]
  openRefs: Array<{ ref: string; source: OpenSource }>
}

export const SEED_ACTIVITY: readonly SeedActivity[] = [
  {
    key: 'kudu',
    weekFoundVia: ['map', 'map', 'map', 'map', 'map', 'share', 'share', 'search', 'push'],
    weekWalkIns: 4,
    returning: 3,
    today: [
      { ref: 'f01', foundVia: 'map', offsetMin: 60 },
      { ref: 'f02', foundVia: 'share', offsetMin: 80 },
      { ref: 'w01', foundVia: 'walk_in', offsetMin: 95 },
      { ref: 'w02', foundVia: 'walk_in', offsetMin: 115 },
    ],
    presentRefs: ['f01', 'f02', 'w01'],
    goingRefs: ['f01', 'f02', 'f03', 'f04', 'f05'],
    openRefs: [
      { ref: 'f03', source: 'map' },
      { ref: 'f04', source: 'share' },
    ],
  },
  {
    key: 'thembi',
    weekFoundVia: ['map', 'map', 'share'],
    weekWalkIns: 2,
    returning: 0,
    today: [
      { ref: 'f01', foundVia: 'search', offsetMin: 450 },
      { ref: 'w01', foundVia: 'walk_in', offsetMin: 470 },
    ],
    presentRefs: ['f01'],
    goingRefs: ['f01', 'f02'],
    openRefs: [{ ref: 'f02', source: 'map' }],
  },
  {
    key: 'loft',
    weekFoundVia: [],
    weekWalkIns: 2,
    returning: 0,
    today: [],
    presentRefs: [],
    goingRefs: [],
    openRefs: [],
  },
]

/** The latest SAST minute-of-day any today row lands on. The writer refuses before it. */
export function latestTodayOffsetMin(): number {
  return Math.max(0, ...SEED_ACTIVITY.flatMap((a) => a.today.map((t) => t.offsetMin)))
}

// ─── Consumers ───────────────────────────────────────────────────────────────

/**
 * A seeded consumer account. No phone: email and id are the only consumer
 * identity primitives (`no-sms-no-phone-auth.md`). `tonightReminder` is true only
 * for the two testers seeded with the Tonight_Reminder preference on.
 */
export interface SeedConsumer {
  userId: string
  username: string
  displayName: string
  email: string
  tonightReminder: boolean
}

function consumer(userId: string, displayName: string, tonightReminder = false): SeedConsumer {
  return {
    userId,
    username: userId.replace(/-/g, '_'),
    displayName,
    email: `${userId}@seed.areacode.invalid`,
    tonightReminder,
  }
}

/** Fresh tester accounts the seed creates (R13.1: at least 12), and how many opt in. */
export const TESTER_COUNT = 12
export const TESTERS_WITH_REMINDER = 2

/**
 * The twelve tester accounts. Deliberately EMPTY of check-ins: a tester must be
 * able to produce the first Found_You at a venue during UAT, and a seeded visit
 * would make them a returning consumer and change the first-timer count.
 */
export const SEED_TESTERS: readonly SeedConsumer[] = Array.from({ length: TESTER_COUNT }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return consumer(`${SEED_PREFIX}-t${n}`, `Seed Tester ${n}`, i < TESTERS_WITH_REMINDER)
})

/** The id of a history consumer. `f` refs are Found_You, `w` refs are Walk_In only. */
export function historyUserId(venueKey: string, ref: string): string {
  return `${SEED_PREFIX}-h-${venueKey}-${ref}`
}

/** The `f01`, `f02`, ... or `w01`, `w02`, ... refs of a venue's history consumers. */
export function refs(prefix: 'f' | 'w', count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)
}

/** Every history consumer, per venue. These produce the seeded Digest_Week. */
export function historyConsumers(): SeedConsumer[] {
  return SEED_ACTIVITY.flatMap((activity) => {
    const venue = venueFor(activity.key)
    return [...refs('f', activity.weekFoundVia.length), ...refs('w', activity.weekWalkIns)].map((ref) =>
      consumer(historyUserId(activity.key, ref), `Seed ${venue.name.replace(' (seed)', '')} ${ref.toUpperCase()}`),
    )
  })
}
