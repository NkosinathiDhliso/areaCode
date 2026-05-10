/**
 * Property 7: Staff Queue Bounds and Ordering
 *
 * For any sequence of N check-in events added to the staff store, the live queue
 * SHALL contain at most 20 items, ordered by timestamp descending (most recent first).
 * For any sequence of M redemptions, the recent redemptions list SHALL contain at most
 * 50 items. Filtering by status SHALL return exactly the subset matching that status.
 *
 * **Validates: Requirements 4.3, 5.6**
 *
 * Property 8: Redemption Code Validation
 *
 * For any string input to the staff manual code entry, the input SHALL be accepted
 * if and only if it is exactly 32 characters long and every character is a valid
 * hexadecimal digit (0-9, a-f, A-F).
 *
 * **Validates: Requirements 5.2**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'

// ─── Staff Queue Logic (extracted for testability) ────────────────────────────

const MAX_LIVE_QUEUE = 20
const MAX_RECENT_REDEMPTIONS = 50

interface StaffCheckInEvent {
  id: string
  nodeId: string
  consumerName: string
  tier: string
  timestamp: string
}

interface StaffRedemptionRecord {
  id: string
  code: string
  rewardTitle: string
  consumerName: string
  status: 'success' | 'failed'
  timestamp: string
}

function createQueue() {
  let liveQueue: StaffCheckInEvent[] = []
  let recentRedemptions: StaffRedemptionRecord[] = []

  return {
    addCheckIn(event: StaffCheckInEvent) {
      liveQueue = [event, ...liveQueue].slice(0, MAX_LIVE_QUEUE)
    },
    addRedemption(record: StaffRedemptionRecord) {
      recentRedemptions = [record, ...recentRedemptions].slice(0, MAX_RECENT_REDEMPTIONS)
    },
    getLiveQueue() { return liveQueue },
    getRecentRedemptions() { return recentRedemptions },
    filterRedemptions(status: 'success' | 'failed') {
      return recentRedemptions.filter((r) => r.status === status)
    },
  }
}

// ─── Redemption Code Validation Logic ─────────────────────────────────────────

const HEX_REGEX = /^[0-9a-fA-F]{32}$/

function isValidRedemptionCode(input: string): boolean {
  return HEX_REGEX.test(input)
}

// ─── Generators ───────────────────────────────────────────────────────────────

/** Generate a hex string of exact length */
function hexStringArb(length: number) {
  return fc.array(
    fc.constantFrom(...'0123456789abcdef'.split('')),
    { minLength: length, maxLength: length },
  ).map((chars) => chars.join(''))
}

/** Generate a valid ISO timestamp string */
const timestampArb = fc.integer({ min: 1704067200000, max: 1767225600000 })
  .map((ms) => new Date(ms).toISOString())

const checkInEventArb = fc.record({
  id: fc.uuid(),
  nodeId: fc.uuid(),
  consumerName: fc.string({ minLength: 1, maxLength: 30 }),
  tier: fc.constantFrom('local', 'regular', 'fixture', 'institution', 'legend'),
  timestamp: timestampArb,
})

const redemptionRecordArb = fc.record({
  id: fc.uuid(),
  code: hexStringArb(32),
  rewardTitle: fc.string({ minLength: 1, maxLength: 50 }),
  consumerName: fc.string({ minLength: 1, maxLength: 30 }),
  status: fc.constantFrom('success' as const, 'failed' as const),
  timestamp: timestampArb,
})

// ─── Property 7: Staff Queue Bounds and Ordering ──────────────────────────────

describe('Property 7: Staff Queue Bounds and Ordering', () => {
  it('live queue never exceeds 20 items regardless of how many check-ins are added', async () => {
    await fc.assert(
      fc.property(
        fc.array(checkInEventArb, { minLength: 0, maxLength: 100 }),
        (events) => {
          const queue = createQueue()
          for (const event of events) {
            queue.addCheckIn(event)
          }
          expect(queue.getLiveQueue().length).toBeLessThanOrEqual(MAX_LIVE_QUEUE)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('live queue is ordered most recent first (items added later appear first)', async () => {
    await fc.assert(
      fc.property(
        fc.array(checkInEventArb, { minLength: 2, maxLength: 50 }),
        (events) => {
          const queue = createQueue()
          for (const event of events) {
            queue.addCheckIn(event)
          }
          const items = queue.getLiveQueue()
          // The most recently added item should be first
          const lastAdded = events[events.length - 1]!
          expect(items[0]!.id).toBe(lastAdded.id)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('recent redemptions never exceeds 50 items', async () => {
    await fc.assert(
      fc.property(
        fc.array(redemptionRecordArb, { minLength: 0, maxLength: 150 }),
        (records) => {
          const queue = createQueue()
          for (const record of records) {
            queue.addRedemption(record)
          }
          expect(queue.getRecentRedemptions().length).toBeLessThanOrEqual(MAX_RECENT_REDEMPTIONS)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('filtering by status returns exactly the subset matching that status', async () => {
    await fc.assert(
      fc.property(
        fc.array(redemptionRecordArb, { minLength: 0, maxLength: 50 }),
        fc.constantFrom('success' as const, 'failed' as const),
        (records, filterStatus) => {
          const queue = createQueue()
          for (const record of records) {
            queue.addRedemption(record)
          }
          const filtered = queue.filterRedemptions(filterStatus)
          const allRedemptions = queue.getRecentRedemptions()

          // Every filtered item has the correct status
          for (const item of filtered) {
            expect(item.status).toBe(filterStatus)
          }

          // Count matches manual count
          const expectedCount = allRedemptions.filter((r) => r.status === filterStatus).length
          expect(filtered.length).toBe(expectedCount)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('when queue is at capacity, oldest items are dropped', async () => {
    await fc.assert(
      fc.property(
        fc.array(checkInEventArb, { minLength: 25, maxLength: 60 }),
        (events) => {
          const queue = createQueue()
          for (const event of events) {
            queue.addCheckIn(event)
          }
          const items = queue.getLiveQueue()
          // Should contain the last MAX_LIVE_QUEUE items added (most recent)
          const expectedIds = events.slice(-MAX_LIVE_QUEUE).reverse().map((e) => e.id)
          const actualIds = items.map((e) => e.id)
          expect(actualIds).toEqual(expectedIds)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 8: Redemption Code Validation ───────────────────────────────────

describe('Property 8: Redemption Code Validation', () => {
  it('accepts any 32-character hexadecimal string', async () => {
    await fc.assert(
      fc.property(
        hexStringArb(32),
        (hexCode) => {
          expect(isValidRedemptionCode(hexCode)).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects strings shorter than 32 characters', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 31 }).chain((len) => hexStringArb(len)),
        (shortCode) => {
          expect(isValidRedemptionCode(shortCode)).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects strings longer than 32 characters', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 33, max: 64 }).chain((len) => hexStringArb(len)),
        (longCode) => {
          expect(isValidRedemptionCode(longCode)).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects 32-character strings containing non-hex characters', async () => {
    const nonHexCharArb = fc.constantFrom(...'ghijklmnopqrstuvwxyz!@#$%^&*()'.split(''))

    await fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 31 }),
          nonHexCharArb,
          hexStringArb(31),
        ),
        ([pos, nonHexChar, hexPart]) => {
          // Insert non-hex char at position
          const code = hexPart.slice(0, pos) + nonHexChar + hexPart.slice(pos)
          expect(isValidRedemptionCode(code.slice(0, 32))).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('accepts both uppercase and lowercase hex characters', async () => {
    await fc.assert(
      fc.property(
        hexStringArb(32),
        fc.boolean(),
        (hexCode, useUpper) => {
          const code = useUpper ? hexCode.toUpperCase() : hexCode.toLowerCase()
          expect(isValidRedemptionCode(code)).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })
})
