/**
 * Integration tests for the schedule-crud Lambda handler.
 *
 * Validates: Requirements 3.5, 3.9, 3.12, 4.5, 4.11, 4.12
 *
 * Coverage:
 *   1. Round-trip CRUD: GET 404 → POST upsert → GET 200 returns canonicalised
 *      → DELETE slot → GET shows fewer slots.
 *   2. Validation failure paths: every `ScheduleValidationCode` returns
 *      400 with `{ code, field, message, slotId? }` (R3.5, R3.7, R3.9, R3.11,
 *      R4.5).
 *   3. Cross_Midnight_Pair: an editor-split pair (one slot ending 23:59 day N,
 *      one slot starting 00:00 day N+1) is persisted as two same-day slots
 *      and round-trips on GET (R3.12, R4.13).
 *   4. JWT-claims mismatch: a request with JWT businessId X targeting path
 *      businessId Y returns 403 with NO DynamoDB I/O (R4.11, R4.12).
 *
 * Strategy:
 *   The schedule-repository module is replaced with an in-memory mock so the
 *   tests verify the handler's authorisation, validation, and canonicalisation
 *   behaviour without a live DynamoDB connection. JWT-mismatch assertions
 *   use the same spies to confirm zero repository calls (the design's R4.11
 *   "before any DynamoDB I/O" guarantee).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

import type { MusicSchedule } from '@area-code/shared/types'
import { ScheduleValidationError } from '@area-code/shared/lib/schedule-validator'

// ─── In-memory repository mock ──────────────────────────────────────────────
//
// The mock's behaviour mirrors the real repository's contract closely enough
// for the handler under test:
//   - getSchedule returns the stored MusicSchedule or null.
//   - upsertSchedule overwrites the stored value and returns the canonical
//     payload that was passed in (the handler has already validated it).
//   - deleteScheduleSlot drops the matching slot and returns the updated
//     schedule. Throws ScheduleValidationError for missing schedule / slot
//     so the handler can translate to 404.

let storedSchedule: MusicSchedule | null = null

const getSchedule = vi.fn(async (_businessId: string, _scheduleId: string): Promise<MusicSchedule | null> => {
  return storedSchedule
})

const upsertSchedule = vi.fn(async (schedule: MusicSchedule): Promise<MusicSchedule> => {
  storedSchedule = schedule
  return schedule
})

const deleteScheduleSlot = vi.fn(
  async (businessId: string, scheduleId: string, slotId: string): Promise<MusicSchedule> => {
    if (!storedSchedule) {
      throw new ScheduleValidationError({
        code: 'schema_shape',
        field: 'scheduleId',
        message: `Music_Schedule not found: ${businessId}/${scheduleId}`,
      })
    }
    const remaining = storedSchedule.slots.filter((s) => s.slotId !== slotId)
    if (remaining.length === storedSchedule.slots.length) {
      throw new ScheduleValidationError({
        code: 'schema_shape',
        field: 'slotId',
        message: `Schedule_Slot not found: ${slotId}`,
        slotId,
      })
    }
    storedSchedule = { ...storedSchedule, slots: remaining }
    return storedSchedule
  },
)

const queryNextTransitions = vi.fn(async () => [])

vi.mock('../schedule-repository.js', () => ({
  getSchedule,
  upsertSchedule,
  deleteScheduleSlot,
  queryNextTransitions,
}))

// ─── Test helpers ───────────────────────────────────────────────────────────

// Dev-mode auth (auth.ts) parses `Bearer dev-<token>` into a userId by
// joining the segments after the leading `dev-`. For `dev-biza` the userId
// becomes `biza`; for path `biza` the authoriseBusinessClaim check passes.
const BUSINESS_A = 'biza'
const BUSINESS_B = 'bizb'

function authHeaderFor(businessId: string): { authorization: string } {
  return { authorization: `Bearer dev-${businessId}` }
}

// A venue-scoped staff session. The dev-mode auth grammar (auth.ts) reads the
// structured `dev-<role>:<userId>:<businessId>` token, so this mints a staff
// session whose resolved `businessId` is `businessId` — exactly what the prod
// verifyToken puts on the payload from the staff row / claim.
function staffAuthHeaderFor(staffId: string, businessId: string): { authorization: string } {
  return { authorization: `Bearer dev-staff:${staffId}:${businessId}` }
}

function urlFor(businessId: string, suffix = ''): string {
  return `/v1/business/${businessId}/music-schedule${suffix}`
}

/** A canonical valid schedule body used by the round-trip and Cross_Midnight
 *  tests. The validator overwrites `startTimeMin`/`endTimeMin` from the
 *  `HH:mm` strings, so the redundant fields here are placeholders. */
function validBlanketBody(): Record<string, unknown> {
  return {
    businessId: BUSINESS_A,
    scheduleId: 'default',
    timezone: 'Africa/Johannesburg',
    slots: [
      {
        slotId: 'fri-evening',
        dayOfWeek: 'FRI',
        startTime: '20:00',
        endTime: '23:00',
        mode: 'blanket',
        genres: ['amapiano', 'deep_house'],
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

/** A Cross_Midnight_Pair (R3.12) — Friday 22:00 → Saturday 04:00 split into
 *  two same-day slots ending at 23:59 / starting at 00:00 with matching
 *  blanket genres. */
function crossMidnightPairBody(): Record<string, unknown> {
  return {
    businessId: BUSINESS_A,
    scheduleId: 'default',
    timezone: 'Africa/Johannesburg',
    slots: [
      {
        slotId: 'fri-late',
        dayOfWeek: 'FRI',
        startTime: '22:00',
        endTime: '23:59',
        mode: 'blanket',
        genres: ['amapiano'],
      },
      {
        slotId: 'sat-early',
        dayOfWeek: 'SAT',
        startTime: '00:00',
        endTime: '04:00',
        mode: 'blanket',
        genres: ['amapiano'],
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

// ─── Fastify app lifecycle ─────────────────────────────────────────────────

let app: FastifyInstance

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  const { buildApp } = await import('../../../app')
  app = await buildApp()
  await app.ready()
}, 120_000)

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  storedSchedule = null
  getSchedule.mockClear()
  upsertSchedule.mockClear()
  deleteScheduleSlot.mockClear()
  queryNextTransitions.mockClear()
})

// ─── 1. Round-trip CRUD ─────────────────────────────────────────────────────

describe('schedule-crud round-trip', () => {
  it('GET → 404 → POST upsert → GET 200 (canonical) → DELETE slot → GET 200 with fewer slots', async () => {
    // Step 1: GET on empty store returns 404.
    const initialGet = await app.inject({
      method: 'GET',
      url: urlFor(BUSINESS_A),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(initialGet.statusCode).toBe(404)

    // Step 2: POST a valid schedule. The handler returns the canonical
    // payload (with derived startTimeMin/endTimeMin populated by the
    // validator).
    const upsert = await app.inject({
      method: 'POST',
      url: urlFor(BUSINESS_A),
      headers: authHeaderFor(BUSINESS_A),
      payload: validBlanketBody(),
    })
    expect(upsert.statusCode).toBe(200)
    const upsertBody = upsert.json() as MusicSchedule
    expect(upsertBody.businessId).toBe(BUSINESS_A)
    expect(upsertBody.scheduleId).toBe('default') // canonicalised by handler
    expect(upsertBody.slots).toHaveLength(1)
    expect(upsertBody.slots[0]!.startTimeMin).toBe(20 * 60) // derived from '20:00'
    expect(upsertBody.slots[0]!.endTimeMin).toBe(23 * 60) // derived from '23:00'
    expect(upsertSchedule).toHaveBeenCalledTimes(1)

    // Step 3: GET returns the stored canonical schedule.
    const afterUpsert = await app.inject({
      method: 'GET',
      url: urlFor(BUSINESS_A),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(afterUpsert.statusCode).toBe(200)
    const afterBody = afterUpsert.json() as MusicSchedule
    expect(afterBody.slots).toHaveLength(1)
    expect(afterBody.slots[0]!.slotId).toBe('fri-evening')
    expect(afterBody.slots[0]!.startTimeMin).toBe(20 * 60)

    // Step 4: DELETE the slot.
    const del = await app.inject({
      method: 'DELETE',
      url: urlFor(BUSINESS_A, '/fri-evening'),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(del.statusCode).toBe(200)
    const delBody = del.json() as MusicSchedule
    expect(delBody.slots).toHaveLength(0)
    expect(deleteScheduleSlot).toHaveBeenCalledWith(BUSINESS_A, 'default', 'fri-evening')

    // Step 5: GET shows the schedule with the slot removed.
    const finalGet = await app.inject({
      method: 'GET',
      url: urlFor(BUSINESS_A),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(finalGet.statusCode).toBe(200)
    const finalBody = finalGet.json() as MusicSchedule
    expect(finalBody.slots).toHaveLength(0)
  })

  it('POST overrides body businessId/scheduleId with the path values (defence-in-depth on R4.11)', async () => {
    const tampered = {
      ...(validBlanketBody() as Record<string, unknown>),
      businessId: 'someone-else',
      scheduleId: 'spoofed-schedule-id',
    }

    const response = await app.inject({
      method: 'POST',
      url: urlFor(BUSINESS_A),
      headers: authHeaderFor(BUSINESS_A),
      payload: tampered,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as MusicSchedule
    expect(body.businessId).toBe(BUSINESS_A)
    expect(body.scheduleId).toBe('default')
  })

  it('DELETE on a missing schedule returns 404', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: urlFor(BUSINESS_A, '/no-such-slot'),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(response.statusCode).toBe(404)
  })

  it('DELETE on a missing slot (schedule exists) returns 404', async () => {
    // Seed a schedule with one slot, then delete a different slotId.
    storedSchedule = {
      businessId: BUSINESS_A,
      scheduleId: 'default',
      timezone: 'Africa/Johannesburg',
      slots: [
        {
          slotId: 'real-slot',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          startTimeMin: 1200,
          endTimeMin: 1380,
          mode: 'blanket',
          genres: ['amapiano'],
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    }

    const response = await app.inject({
      method: 'DELETE',
      url: urlFor(BUSINESS_A, '/ghost-slot'),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(response.statusCode).toBe(404)
  })
})

// ─── 2. Validation failure paths ────────────────────────────────────────────

interface ValidationCase {
  name: string
  expectedCode: string
  body: () => Record<string, unknown>
  /** True when the failing field has a slot context (R3.5/R3.7/R3.9 errors). */
  expectsSlotId?: boolean
}

/**
 * Each case maps to one `ScheduleValidationCode` and a body designed to
 * trigger exactly that branch of `validateMusicSchedule`. The list mirrors
 * the codes called out by the task; cases are positioned so they hit the
 * targeted branch BEFORE any earlier branch can short-circuit (the
 * validator runs steps in order).
 */
const VALIDATION_CASES: ValidationCase[] = [
  {
    name: 'schema_shape — slots missing',
    expectedCode: 'schema_shape',
    body: () => ({
      businessId: BUSINESS_A,
      scheduleId: 'default',
      timezone: 'Africa/Johannesburg',
      // slots intentionally omitted
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    }),
  },
  {
    name: 'invalid_timezone — unknown IANA id',
    expectedCode: 'invalid_timezone',
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      timezone: 'Mars/Olympus_Mons',
    }),
  },
  {
    name: 'invalid_slot_interval — startTime equals endTime',
    expectedCode: 'invalid_slot_interval',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'zero-len',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '20:00',
          mode: 'blanket',
          genres: ['amapiano'],
        },
      ],
    }),
  },
  {
    name: 'invalid_blanket_genres — empty genres array',
    expectedCode: 'invalid_blanket_genres',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'no-genres',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'blanket',
          genres: [],
        },
      ],
    }),
  },
  {
    name: 'blanket_must_not_have_lineup — blanket slot carrying a lineup field',
    expectedCode: 'blanket_must_not_have_lineup',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'mixed-blanket',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'blanket',
          genres: ['amapiano'],
          lineup: [{ startTime: '20:00', genres: ['amapiano'] }],
        },
      ],
    }),
  },
  {
    name: 'lineup_must_not_have_top_genres — lineup slot carrying top-level genres',
    expectedCode: 'lineup_must_not_have_top_genres',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'mixed-lineup',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          genres: ['amapiano'],
          lineup: [{ startTime: '20:00', genres: ['amapiano'] }],
        },
      ],
    }),
  },
  {
    name: 'lineup_first_entry_misaligned — first entry not at slot start',
    expectedCode: 'lineup_first_entry_misaligned',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'misaligned',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          lineup: [
            { startTime: '20:30', genres: ['amapiano'] },
            { startTime: '21:00', genres: ['deep_house'] },
          ],
        },
      ],
    }),
  },
  {
    name: 'lineup_entry_outside_slot — second entry at slot.endTime (out of half-open interval)',
    expectedCode: 'lineup_entry_outside_slot',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'overflow',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          lineup: [
            { startTime: '20:00', genres: ['amapiano'] },
            { startTime: '23:00', genres: ['deep_house'] },
          ],
        },
      ],
    }),
  },
  {
    name: 'lineup_duplicate_start_times — two entries at the same time',
    expectedCode: 'lineup_duplicate_start_times',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'dup-times',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          lineup: [
            { startTime: '20:00', genres: ['amapiano'] },
            { startTime: '20:00', genres: ['deep_house'] },
          ],
        },
      ],
    }),
  },
  {
    name: 'overlapping_slots — two slots on FRI with intersecting intervals',
    expectedCode: 'overlapping_slots',
    expectsSlotId: true,
    body: () => ({
      ...(validBlanketBody() as Record<string, unknown>),
      slots: [
        {
          slotId: 'first',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'blanket',
          genres: ['amapiano'],
        },
        {
          slotId: 'overlapper',
          dayOfWeek: 'FRI',
          startTime: '22:00',
          endTime: '23:30',
          mode: 'blanket',
          genres: ['deep_house'],
        },
      ],
    }),
  },
]

describe('schedule-crud validation failures', () => {
  for (const testCase of VALIDATION_CASES) {
    it(`POST returns 400 with structured error for ${testCase.name}`, async () => {
      const response = await app.inject({
        method: 'POST',
        url: urlFor(BUSINESS_A),
        headers: authHeaderFor(BUSINESS_A),
        payload: testCase.body(),
      })

      expect(response.statusCode).toBe(400)
      const body = response.json() as Record<string, unknown>

      // Structured error contract: { error, message, statusCode, code, field, slotId? }
      expect(body['error']).toBe('validation_error')
      expect(typeof body['message']).toBe('string')
      expect(body['statusCode']).toBe(400)
      expect(body['code']).toBe(testCase.expectedCode)
      expect(typeof body['field']).toBe('string')
      expect((body['field'] as string).length).toBeGreaterThan(0)

      if (testCase.expectsSlotId) {
        expect(typeof body['slotId']).toBe('string')
      }

      // Validation failures must NEVER reach the repository (R4.5: surface
      // server validation errors before persisting).
      expect(upsertSchedule).not.toHaveBeenCalled()
    })
  }
})

// ─── 3. Cross_Midnight_Pair persistence (R3.12, R4.13) ──────────────────────

describe('Cross_Midnight_Pair persistence', () => {
  it('persists an editor-split pair as two same-day slots and round-trips on GET', async () => {
    const upsert = await app.inject({
      method: 'POST',
      url: urlFor(BUSINESS_A),
      headers: authHeaderFor(BUSINESS_A),
      payload: crossMidnightPairBody(),
    })
    expect(upsert.statusCode).toBe(200)

    const upsertBody = upsert.json() as MusicSchedule
    expect(upsertBody.slots).toHaveLength(2)

    // Both slots are same-day (R3.12: data model only stores two same-day
    // slots; the wrap-around concept lives in the editor).
    const friSlot = upsertBody.slots.find((s) => s.slotId === 'fri-late')
    const satSlot = upsertBody.slots.find((s) => s.slotId === 'sat-early')
    expect(friSlot).toBeDefined()
    expect(satSlot).toBeDefined()
    expect(friSlot!.dayOfWeek).toBe('FRI')
    expect(friSlot!.endTime).toBe('23:59')
    expect(satSlot!.dayOfWeek).toBe('SAT')
    expect(satSlot!.startTime).toBe('00:00')

    // Both halves carry the same blanket genres so the read-side pairing
    // rule (same `(businessId, mode)`, abutting times, matching genres) can
    // re-derive the Cross_Midnight_Pair.
    expect(friSlot!.mode).toBe('blanket')
    expect(satSlot!.mode).toBe('blanket')
    expect(friSlot!.genres).toEqual(['amapiano'])
    expect(satSlot!.genres).toEqual(['amapiano'])

    // Derived minutes-since-midnight values are populated correctly so the
    // pair joins exactly at midnight on disk.
    expect(friSlot!.endTimeMin).toBe(23 * 60 + 59)
    expect(satSlot!.startTimeMin).toBe(0)

    // GET re-derives the pair from the persisted same-day slots.
    const getAfter = await app.inject({
      method: 'GET',
      url: urlFor(BUSINESS_A),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(getAfter.statusCode).toBe(200)
    const afterBody = getAfter.json() as MusicSchedule
    expect(afterBody.slots).toHaveLength(2)
    expect(afterBody.slots.map((s) => s.dayOfWeek).sort()).toEqual(['FRI', 'SAT'])
    expect(afterBody.slots.find((s) => s.dayOfWeek === 'FRI')!.endTime).toBe('23:59')
    expect(afterBody.slots.find((s) => s.dayOfWeek === 'SAT')!.startTime).toBe('00:00')
  })
})

// ─── 4. JWT-claims mismatch (R4.11, R4.12) ──────────────────────────────────

describe('JWT-claims mismatch returns 403 with no DynamoDB I/O', () => {
  it('GET with mismatched businessId returns 403 and never touches the repository', async () => {
    const response = await app.inject({
      method: 'GET',
      url: urlFor(BUSINESS_B),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(response.statusCode).toBe(403)

    expect(getSchedule).not.toHaveBeenCalled()
    expect(upsertSchedule).not.toHaveBeenCalled()
    expect(deleteScheduleSlot).not.toHaveBeenCalled()
  })

  it('POST with mismatched businessId returns 403 BEFORE validation OR repository I/O', async () => {
    // Use a payload that would otherwise be valid — the 403 must short-circuit
    // before the validator and the repository run, otherwise the design's
    // R4.11 "no DynamoDB I/O before authorisation" guarantee is broken.
    const response = await app.inject({
      method: 'POST',
      url: urlFor(BUSINESS_B),
      headers: authHeaderFor(BUSINESS_A),
      payload: validBlanketBody(),
    })
    expect(response.statusCode).toBe(403)

    expect(getSchedule).not.toHaveBeenCalled()
    expect(upsertSchedule).not.toHaveBeenCalled()
    expect(deleteScheduleSlot).not.toHaveBeenCalled()
  })

  it('DELETE with mismatched businessId returns 403 and never touches the repository', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: urlFor(BUSINESS_B, '/some-slot'),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(response.statusCode).toBe(403)

    expect(getSchedule).not.toHaveBeenCalled()
    expect(upsertSchedule).not.toHaveBeenCalled()
    expect(deleteScheduleSlot).not.toHaveBeenCalled()
  })
})

// ─── 5. Venue-scoped staff sessions (single source of truth) ────────────────
//
// Staff set the vibe through the SAME endpoints the operator uses. A staff
// session carries its resolved `businessId`; the schedule routes authorise
// GET/POST/DELETE for a staff member whose venue matches the path, and reject a
// staff member scoped to a different venue (fail closed, no I/O). A Manager
// authenticates through the staff pool, so delete parity with create lets a
// role that can add a slot also remove one for the same venue (item B, R2.1-2.4).

describe('venue-scoped staff sessions on the shared schedule endpoints', () => {
  const STAFF_ID = 'staff-1'

  it('staff whose businessId matches the path can GET and POST', async () => {
    // POST: a staff member scoped to BUSINESS_A writes BUSINESS_A's schedule.
    const upsert = await app.inject({
      method: 'POST',
      url: urlFor(BUSINESS_A),
      headers: staffAuthHeaderFor(STAFF_ID, BUSINESS_A),
      payload: validBlanketBody(),
    })
    expect(upsert.statusCode).toBe(200)
    const upsertBody = upsert.json() as MusicSchedule
    expect(upsertBody.businessId).toBe(BUSINESS_A)
    expect(upsertBody.scheduleId).toBe('default')
    expect(upsertSchedule).toHaveBeenCalledTimes(1)

    // GET: the same staff member reads it back through the same endpoint.
    const get = await app.inject({
      method: 'GET',
      url: urlFor(BUSINESS_A),
      headers: staffAuthHeaderFor(STAFF_ID, BUSINESS_A),
    })
    expect(get.statusCode).toBe(200)
    const getBody = get.json() as MusicSchedule
    expect(getBody.businessId).toBe(BUSINESS_A)
    expect(getBody.slots).toHaveLength(1)
    expect(getBody.slots[0]!.slotId).toBe('fri-evening')
  })

  it('staff scoped to a DIFFERENT venue is rejected 403 on GET with no schedule I/O', async () => {
    const response = await app.inject({
      method: 'GET',
      url: urlFor(BUSINESS_B),
      headers: staffAuthHeaderFor(STAFF_ID, BUSINESS_A),
    })
    expect(response.statusCode).toBe(403)

    expect(getSchedule).not.toHaveBeenCalled()
    expect(upsertSchedule).not.toHaveBeenCalled()
    expect(deleteScheduleSlot).not.toHaveBeenCalled()
  })

  it('staff scoped to a DIFFERENT venue is rejected 403 on POST BEFORE validation OR repository I/O', async () => {
    // An otherwise-valid payload must not be validated or persisted: the 403
    // short-circuits before any schedule work (fail closed, deny by default).
    const response = await app.inject({
      method: 'POST',
      url: urlFor(BUSINESS_B),
      headers: staffAuthHeaderFor(STAFF_ID, BUSINESS_A),
      payload: validBlanketBody(),
    })
    expect(response.statusCode).toBe(403)

    expect(getSchedule).not.toHaveBeenCalled()
    expect(upsertSchedule).not.toHaveBeenCalled()
    expect(deleteScheduleSlot).not.toHaveBeenCalled()
  })

  it('staff whose businessId matches the path can DELETE a slot (create/delete parity, R2.1)', async () => {
    // Seed a schedule so a successful delete touches the repo and returns 200.
    storedSchedule = {
      businessId: BUSINESS_A,
      scheduleId: 'default',
      timezone: 'Africa/Johannesburg',
      slots: [
        {
          slotId: 'real-slot',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          startTimeMin: 1200,
          endTimeMin: 1380,
          mode: 'blanket',
          genres: ['amapiano'],
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    }

    // A Manager authenticates through the staff pool. With a resolved
    // businessId matching the path, DELETE is authorised on the same role
    // basis as create (R2.1, R2.3) and the slot is removed.
    const response = await app.inject({
      method: 'DELETE',
      url: urlFor(BUSINESS_A, '/real-slot'),
      headers: staffAuthHeaderFor(STAFF_ID, BUSINESS_A),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as MusicSchedule
    expect(body.slots).toHaveLength(0)
    expect(deleteScheduleSlot).toHaveBeenCalledWith(BUSINESS_A, 'default', 'real-slot')
  })

  it('staff scoped to a DIFFERENT venue is rejected 403 on DELETE with no schedule I/O (R2.2, R2.4)', async () => {
    // Seed BUSINESS_A's schedule; a staff session scoped to BUSINESS_A must
    // NOT be able to delete BUSINESS_B's slot. The cross-business guard
    // (authoriseScheduleAccess) fails closed BEFORE any repository I/O.
    storedSchedule = {
      businessId: BUSINESS_B,
      scheduleId: 'default',
      timezone: 'Africa/Johannesburg',
      slots: [
        {
          slotId: 'real-slot',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          startTimeMin: 1200,
          endTimeMin: 1380,
          mode: 'blanket',
          genres: ['amapiano'],
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    }

    const response = await app.inject({
      method: 'DELETE',
      url: urlFor(BUSINESS_B, '/real-slot'),
      headers: staffAuthHeaderFor(STAFF_ID, BUSINESS_A),
    })
    expect(response.statusCode).toBe(403)
    expect(deleteScheduleSlot).not.toHaveBeenCalled()
  })

  it('business-pool owner can DELETE a slot for their own venue (R2.1)', async () => {
    storedSchedule = {
      businessId: BUSINESS_A,
      scheduleId: 'default',
      timezone: 'Africa/Johannesburg',
      slots: [
        {
          slotId: 'real-slot',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          startTimeMin: 1200,
          endTimeMin: 1380,
          mode: 'blanket',
          genres: ['amapiano'],
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    }

    const response = await app.inject({
      method: 'DELETE',
      url: urlFor(BUSINESS_A, '/real-slot'),
      headers: authHeaderFor(BUSINESS_A),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as MusicSchedule
    expect(body.slots).toHaveLength(0)
    expect(deleteScheduleSlot).toHaveBeenCalledWith(BUSINESS_A, 'default', 'real-slot')
  })
})
