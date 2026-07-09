/**
 * Redeem stamp ordering — `markRedemptionAsRedeemed` unit tests (R2.4).
 *
 * On a staff validation the redeem path must flip the REDEMPTION row FIRST (it
 * is the authoritative double-redeem gate), then stamp `redeemedAt` onto the
 * Claim_Guard row (`REWARD_CLAIM#{rewardId}#{userId}`) so the re-mint decision
 * is decidable by the guard's conditional write alone. A failed guard stamp is
 * logged loudly and NEVER rolls back the redemption (fail toward the business).
 *
 * The real repository runs against a mocked `documentClient`; the shared
 * `isConditionalCheckFailedError` detector is preserved via `importOriginal`
 * so the stamp's benign-no-op branch is exercised for real. Command ordering is
 * read off the captured `UpdateCommand.input.Key.pk` values.
 *
 * **Validates: Requirement 2.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return {
    ...actual,
    documentClient: { send: mocks.send },
    TableNames: { ...actual.TableNames, appData: 'app-data' },
  }
})

import { markRedemptionAsRedeemed } from '../dynamodb-repository.js'

const REDEMPTION_ID = 'redemption-1'
const REWARD_ID = 'reward-1'
const USER_ID = 'user-1'

/** Pull the `pk` prefix off a captured UpdateCommand so we can order the writes. */
function keyPk(command: unknown): string {
  return (command as { input: { Key: { pk: string } } }).input.Key.pk
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('markRedemptionAsRedeemed flips the redemption row before stamping the guard (R2.4)', () => {
  it('sends the REDEMPTION# write first, then the REWARD_CLAIM# stamp', async () => {
    // 1st send: flip redemption row, ALL_NEW returns rewardId + userId.
    // 2nd send: guard stamp succeeds.
    mocks.send.mockResolvedValueOnce({ Attributes: { rewardId: REWARD_ID, userId: USER_ID } }).mockResolvedValueOnce({})

    await markRedemptionAsRedeemed(REDEMPTION_ID, '2025-06-01T12:00:00.000Z', 'staff-1', 'Sipho')

    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(keyPk(mocks.send.mock.calls[0]![0])).toBe(`REDEMPTION#${REDEMPTION_ID}`)
    expect(keyPk(mocks.send.mock.calls[1]![0])).toBe(`REWARD_CLAIM#${REWARD_ID}#${USER_ID}`)
  })

  it('does not attempt a guard stamp when the redemption row lacks rewardId/userId', async () => {
    // Legacy redemption row missing the ids needed to build the guard key.
    mocks.send.mockResolvedValueOnce({ Attributes: { redemptionCode: 'ABCD2345' } })

    await markRedemptionAsRedeemed(REDEMPTION_ID)

    // Only the redemption-row flip runs; no second (guard) write is attempted.
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(keyPk(mocks.send.mock.calls[0]![0])).toBe(`REDEMPTION#${REDEMPTION_ID}`)
    expect(console.error).toHaveBeenCalled()
  })

  it('keeps the redemption flipped when the guard stamp fails (never rolls back)', async () => {
    const stampError = new Error('ProvisionedThroughputExceededException')
    stampError.name = 'ProvisionedThroughputExceededException'
    mocks.send
      .mockResolvedValueOnce({ Attributes: { rewardId: REWARD_ID, userId: USER_ID } })
      .mockRejectedValueOnce(stampError)

    // A real (non-conditional) stamp failure is logged loudly and swallowed:
    // the redemption stands (no throw, no rollback write).
    await expect(markRedemptionAsRedeemed(REDEMPTION_ID)).resolves.toBeUndefined()

    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalled()
  })

  it('treats a conditional-check stamp failure as a benign no-op (legacy/advanced guard)', async () => {
    const conditional = new Error('The conditional request failed')
    conditional.name = 'ConditionalCheckFailedException'
    mocks.send
      .mockResolvedValueOnce({ Attributes: { rewardId: REWARD_ID, userId: USER_ID } })
      .mockRejectedValueOnce(conditional)

    await expect(markRedemptionAsRedeemed(REDEMPTION_ID)).resolves.toBeUndefined()

    // Surfaced as a warning, not an error, and never rethrown.
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(console.warn).toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })
})
