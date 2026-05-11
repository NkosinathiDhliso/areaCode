import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── SAST Offset ────────────────────────────────────────────────────────────

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000 // UTC+2

// ─── Pure at-risk computation (mirrors profile-handler.ts logic) ────────────

/**
 * Determines whether a streak is at risk.
 *
 * The at-risk flag is true if and only if:
 *   - streakCount > 0, AND
 *   - the last check-in date (in SAST) is before today's date (in SAST)
 *
 * This mirrors the logic in backend/src/features/auth/profile-handler.ts
 */
function computeAtRisk(streakCount: number, lastCheckInTimestamp: Date | null, now: Date): boolean {
  if (streakCount <= 0) return false
  if (!lastCheckInTimestamp) return true

  const lastCheckInSAST = new Date(lastCheckInTimestamp.getTime() + SAST_OFFSET_MS)
  const nowSAST = new Date(now.getTime() + SAST_OFFSET_MS)

  const lastCheckInDate = lastCheckInSAST.toISOString().slice(0, 10)
  const todayDate = nowSAST.toISOString().slice(0, 10)

  return lastCheckInDate < todayDate
}

// ─── Helper: get SAST date string from a UTC Date ───────────────────────────

function toSASTDateStr(utcDate: Date): string {
  return new Date(utcDate.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10)
}

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generates a positive streak count (1–1000) */
const positiveStreakArb = fc.integer({ min: 1, max: 1000 })

/**
 * Generates a valid UTC timestamp within a reasonable range.
 * Uses integer milliseconds to avoid NaN date issues.
 */
const validDateArb = fc
  .integer({
    min: new Date('2024-01-01T00:00:00Z').getTime(),
    max: new Date('2026-12-31T23:59:59Z').getTime(),
  })
  .map((ms) => new Date(ms))

/**
 * Generates a "now" and a "lastCheckIn" that are on the SAME SAST day.
 */
const sameSastDayArb = fc
  .integer({
    min: new Date('2024-01-02T00:00:00Z').getTime(),
    max: new Date('2026-12-30T23:59:59Z').getTime(),
  })
  .chain((nowMs) => {
    const now = new Date(nowMs)
    // Compute the SAST day start for "now"
    const nowSAST = new Date(nowMs + SAST_OFFSET_MS)
    const sastDayStr = nowSAST.toISOString().slice(0, 10)
    // SAST day starts at 00:00 SAST = 22:00 UTC previous day
    const dayStartUTC = new Date(sastDayStr + 'T00:00:00Z').getTime() - SAST_OFFSET_MS
    // SAST day ends at 23:59:59 SAST = 21:59:59 UTC same day
    const dayEndUTC = dayStartUTC + 24 * 60 * 60 * 1000 - 1

    // lastCheckIn is somewhere in the same SAST day, up to "now"
    const maxLastCheckIn = Math.min(nowMs, dayEndUTC)
    return fc.integer({ min: dayStartUTC, max: maxLastCheckIn }).map((lastMs) => ({
      now,
      lastCheckIn: new Date(lastMs),
    }))
  })

/**
 * Generates a "now" and a "lastCheckIn" that are on DIFFERENT SAST days
 * (lastCheckIn is at least 1 SAST day before now).
 */
const previousSastDayArb = fc
  .integer({
    min: new Date('2024-01-03T00:00:00Z').getTime(),
    max: new Date('2026-12-30T23:59:59Z').getTime(),
  })
  .chain((nowMs) => {
    const now = new Date(nowMs)
    // Compute the SAST day start for "now"
    const nowSAST = new Date(nowMs + SAST_OFFSET_MS)
    const sastDayStr = nowSAST.toISOString().slice(0, 10)
    const dayStartUTC = new Date(sastDayStr + 'T00:00:00Z').getTime() - SAST_OFFSET_MS

    // lastCheckIn must be before the start of today's SAST day
    const minLastCheckIn = new Date('2024-01-01T00:00:00Z').getTime()
    const maxLastCheckIn = dayStartUTC - 1

    if (maxLastCheckIn < minLastCheckIn) {
      // Edge case: now is on the first possible day, just use a fixed earlier date
      return fc.constant({
        now,
        lastCheckIn: new Date(minLastCheckIn),
      })
    }

    return fc.integer({ min: minLastCheckIn, max: maxLastCheckIn }).map((lastMs) => ({
      now,
      lastCheckIn: new Date(lastMs),
    }))
  })

// ─── Property 4: Streak at-risk detection ───────────────────────────────────

describe('Property 4: Streak at-risk detection', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any consumer with a streak count > 0 and a last check-in date,
   * the at-risk flag SHALL be true if and only if the last check-in date
   * (in SAST) is before today's date (in SAST).
   */

  it('atRisk is false when streakCount is 0 regardless of last check-in', () => {
    fc.assert(
      fc.property(validDateArb, validDateArb, (lastCheckIn, now) => {
        const result = computeAtRisk(0, lastCheckIn, now)
        expect(result).toBe(false)
      }),
      { numRuns: 500 },
    )
  })

  it('atRisk is true when streakCount > 0 and lastCheckIn is null (no history)', () => {
    fc.assert(
      fc.property(positiveStreakArb, validDateArb, (streakCount, now) => {
        const result = computeAtRisk(streakCount, null, now)
        expect(result).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('atRisk is false when last check-in is on the same SAST day as now', () => {
    fc.assert(
      fc.property(positiveStreakArb, sameSastDayArb, (streakCount, { now, lastCheckIn }) => {
        // Verify precondition: same SAST day
        expect(toSASTDateStr(lastCheckIn)).toBe(toSASTDateStr(now))

        const result = computeAtRisk(streakCount, lastCheckIn, now)
        expect(result).toBe(false)
      }),
      { numRuns: 1000 },
    )
  })

  it('atRisk is true when last check-in is on a previous SAST day', () => {
    fc.assert(
      fc.property(positiveStreakArb, previousSastDayArb, (streakCount, { now, lastCheckIn }) => {
        // Verify precondition: different SAST days with lastCheckIn before now
        const lastDate = toSASTDateStr(lastCheckIn)
        const todayDate = toSASTDateStr(now)
        expect(lastDate < todayDate).toBe(true)

        const result = computeAtRisk(streakCount, lastCheckIn, now)
        expect(result).toBe(true)
      }),
      { numRuns: 1000 },
    )
  })

  it('atRisk biconditional: true iff lastCheckInDate(SAST) < today(SAST) when streak > 0', () => {
    fc.assert(
      fc.property(positiveStreakArb, validDateArb, validDateArb, (streakCount, lastCheckIn, now) => {
        const lastDate = toSASTDateStr(lastCheckIn)
        const todayDate = toSASTDateStr(now)

        const expectedAtRisk = lastDate < todayDate
        const result = computeAtRisk(streakCount, lastCheckIn, now)

        expect(result).toBe(expectedAtRisk)
      }),
      { numRuns: 2000 },
    )
  })

  it('SAST timezone boundary: check-in at 23:59 UTC is 01:59 SAST next day', () => {
    fc.assert(
      fc.property(
        positiveStreakArb,
        fc.integer({ min: 2024, max: 2026 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (streakCount, year, month, day) => {
          // "now" is at 23:00 UTC on year/month/day
          // In SAST this is 01:00 on the NEXT day
          const nowUTC = new Date(Date.UTC(year, month - 1, day, 23, 0, 0))

          // lastCheckIn at 21:59 UTC same calendar day
          // In SAST this is 23:59 on the SAME calendar day
          const lastCheckInUTC = new Date(Date.UTC(year, month - 1, day, 21, 59, 0))

          // In SAST: now is on day+1, lastCheckIn is on day → different days → at risk
          const nowSASTDate = toSASTDateStr(nowUTC)
          const lastSASTDate = toSASTDateStr(lastCheckInUTC)

          const expectedAtRisk = lastSASTDate < nowSASTDate
          const result = computeAtRisk(streakCount, lastCheckInUTC, nowUTC)
          expect(result).toBe(expectedAtRisk)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('check-in exactly at midnight SAST (22:00 UTC) counts as the new day', () => {
    fc.assert(
      fc.property(
        positiveStreakArb,
        fc.integer({ min: 2024, max: 2026 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 2, max: 28 }),
        (streakCount, year, month, day) => {
          // "now" is at 22:01 UTC → 00:01 SAST on day
          const nowUTC = new Date(Date.UTC(year, month - 1, day, 22, 1, 0))

          // lastCheckIn at exactly 22:00 UTC → 00:00 SAST on same day
          const lastCheckInUTC = new Date(Date.UTC(year, month - 1, day, 22, 0, 0))

          // Both are on the same SAST day, so atRisk should be false
          expect(toSASTDateStr(nowUTC)).toBe(toSASTDateStr(lastCheckInUTC))
          const result = computeAtRisk(streakCount, lastCheckInUTC, nowUTC)
          expect(result).toBe(false)
        },
      ),
      { numRuns: 500 },
    )
  })
})
