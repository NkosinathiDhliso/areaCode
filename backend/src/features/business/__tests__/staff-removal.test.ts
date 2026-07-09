/**
 * Staff removal and invite revocation repository writes.
 *
 * Locks two regressions:
 *   1. `removeStaffAccount` must deactivate the rows staff actually live in —
 *      the profile row (STAFF#{id} / PROFILE#{id}) and the business-list row
 *      (BIZ_STAFF#{businessId} / STAFF#{id}). The prior key
 *      (STAFF#{id} / BIZ#{businessId}) matched neither, so removal silently
 *      deactivated nothing.
 *   2. `deleteStaffInvite` must scope the delete to the owning business and an
 *      unaccepted invite, and report count 0 on a conditional miss so the
 *      service can surface notFound.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  isConditionalCheckFailedError: (err: unknown) =>
    (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
  TableNames: { appData: 'app-data', businesses: 'businesses' },
}))

import { removeStaffAccount, deleteStaffInvite } from '../repository.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('removeStaffAccount', () => {
  it('deactivates the profile row and the business-list row', async () => {
    mocks.send.mockResolvedValueOnce({})
    const res = await removeStaffAccount('staff-1', 'biz-1')
    expect(res).toEqual({ count: 1 })

    const input = mocks.send.mock.calls[0]![0].input as {
      TransactItems: { Update: { Key: { pk: string; sk: string }; ConditionExpression?: string } }[]
    }
    const keys = input.TransactItems.map((t) => `${t.Update.Key.pk}/${t.Update.Key.sk}`)
    expect(keys).toContain('STAFF#staff-1/PROFILE#staff-1')
    expect(keys).toContain('BIZ_STAFF#biz-1/STAFF#staff-1')
    // Existence is asserted on the profile row so the notFound guard is real.
    const profile = input.TransactItems.find((t) => t.Update.Key.pk === 'STAFF#staff-1')
    expect(profile!.Update.ConditionExpression).toContain('attribute_exists(pk)')
  })

  it('returns count 0 when the staff row does not exist (transaction cancelled)', async () => {
    mocks.send.mockRejectedValueOnce({ name: 'TransactionCanceledException' })
    const res = await removeStaffAccount('missing', 'biz-1')
    expect(res).toEqual({ count: 0 })
  })

  it('rethrows unexpected errors', async () => {
    mocks.send.mockRejectedValueOnce({ name: 'ProvisionedThroughputExceededException' })
    await expect(removeStaffAccount('staff-1', 'biz-1')).rejects.toMatchObject({
      name: 'ProvisionedThroughputExceededException',
    })
  })
})

describe('deleteStaffInvite', () => {
  it('deletes scoped to the business and an unaccepted invite', async () => {
    mocks.send.mockResolvedValueOnce({})
    const res = await deleteStaffInvite('biz-1', 'tok-abc')
    expect(res).toEqual({ count: 1 })

    const input = mocks.send.mock.calls[0]![0].input as {
      Key: { pk: string; sk: string }
      ConditionExpression: string
      ExpressionAttributeValues: Record<string, unknown>
    }
    expect(input.Key).toEqual({ pk: 'STAFF_INVITE#tok-abc', sk: 'STAFF_INVITE#tok-abc' })
    expect(input.ConditionExpression).toContain('businessId = :bid')
    expect(input.ConditionExpression).toContain('accepted = :false')
    expect(input.ExpressionAttributeValues).toMatchObject({ ':bid': 'biz-1', ':false': false })
  })

  it('returns count 0 when the invite is missing or owned by another business', async () => {
    mocks.send.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
    const res = await deleteStaffInvite('biz-1', 'tok-abc')
    expect(res).toEqual({ count: 0 })
  })
})
