/**
 * Tonight_Reminder fan-out (proof-of-demand R9.6, R9.7, R9.10, task 10.6).
 *
 * The reminder is the one push this feature sends, so the rules around it are
 * the ones worth pinning:
 *
 *  - once per row: the row is CLAIMED before the send, so a duplicate tick or a
 *    re-run cannot put a second notification on the same phone
 *  - opt-in only: delivery goes through `sendNotification` with the
 *    `tonight_reminder` type and no preference bypass, so the gate on
 *    `tonightReminder` is the thing that decides who is reached (R9.6, R10.5)
 *  - intent, never arrival: the copy says the night is starting. It may never
 *    say a person is "coming" or "will arrive" (R9.3, `honest-presence.md`)
 *  - a night nobody asked about costs nothing: no opted-in row means no venue
 *    read and no send
 *
 * _Requirements: 9.6, 9.7, 9.10_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listGoingAwaitingReminder: vi.fn(),
  claimGoingReminder: vi.fn(),
  getNodeById: vi.fn(),
  sendNotification: vi.fn(),
}))

vi.mock('../going-repository.js', () => ({
  listGoingAwaitingReminder: mocks.listGoingAwaitingReminder,
  claimGoingReminder: mocks.claimGoingReminder,
}))

vi.mock('../repository.js', () => ({ getNodeById: mocks.getNodeById }))

vi.mock('../../notifications/service.js', () => ({ sendNotification: mocks.sendNotification }))

import { sendTonightReminders } from '../tonight-reminder'

const NODE_ID = 'node-1'
const NIGHT = '2026-03-06'
const NOW = '2026-03-06T19:00:00.000Z'

/** Words that would turn a mark into an arrival claim (R9.3). */
const FORBIDDEN = [/\bcoming\b/i, /\bwill arrive\b/i, /\barrived\b/i, /\barriving\b/i]

beforeEach(() => {
  mocks.listGoingAwaitingReminder.mockReset().mockResolvedValue([])
  mocks.claimGoingReminder.mockReset().mockResolvedValue(true)
  mocks.getNodeById.mockReset().mockResolvedValue({ nodeId: NODE_ID, name: 'The Lookout', slug: 'the-lookout' })
  mocks.sendNotification.mockReset().mockResolvedValue({ delivered: 'socket' })
})

function rows(...userIds: string[]): Array<{ userId: string; nodeId: string; date: string }> {
  return userIds.map((userId) => ({ userId, nodeId: NODE_ID, date: NIGHT }))
}

function send() {
  return sendTonightReminders({ nodeId: NODE_ID, date: NIGHT, headline: 'Amapiano all night', nowIso: NOW })
}

// ─── Delivery ────────────────────────────────────────────────────────────────

describe('sendTonightReminders reaches the consumers who asked (R9.6, R9.7)', () => {
  it('sends one reminder per opted-in row', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1', 'u2', 'u3'))

    const outcome = await send()

    expect(outcome).toEqual({ candidates: 3, sent: 3, alreadyReminded: 0, failed: 0 })
    expect(mocks.sendNotification).toHaveBeenCalledTimes(3)
    expect(mocks.sendNotification.mock.calls.map((call) => call[0].userId)).toEqual(['u1', 'u2', 'u3'])
  })

  it('leaves the preference gate in charge of who is reached', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1'))

    await send()

    const options = mocks.sendNotification.mock.calls[0][0]
    expect(options.type).toBe('tonight_reminder')
    // No bypass: `sendNotification` reads `tonightReminder` for this type, so a
    // consumer who never opted in is blocked there (R9.6, R10.5).
    expect(options.skipPreferenceCheck).toBeUndefined()
  })

  it('lands the click-through on the venue card with src=push', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1'))

    await send()

    expect(mocks.sendNotification.mock.calls[0][0].data).toMatchObject({
      nodeId: NODE_ID,
      date: NIGHT,
      url: '/map?venue=the-lookout&src=push',
    })
  })

  it('reads the venue once, not once per consumer', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1', 'u2', 'u3'))

    await send()

    expect(mocks.getNodeById).toHaveBeenCalledTimes(1)
  })
})

// ─── Honest copy ─────────────────────────────────────────────────────────────

describe('the reminder describes the night, never a person arriving (R9.3)', () => {
  it('states that the night is starting, with the owner headline', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1'))

    await send()

    const { title, body } = mocks.sendNotification.mock.calls[0][0]
    expect(title).toBe('Tonight at The Lookout')
    expect(body).toBe('Amapiano all night is starting now at The Lookout.')
    for (const matcher of [...FORBIDDEN]) {
      expect(matcher.test(`${title} ${body}`)).toBe(false)
    }
  })

  it('says only what it knows when the owner published no headline', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1'))

    await sendTonightReminders({ nodeId: NODE_ID, date: NIGHT, headline: null, nowIso: NOW })

    const { body } = mocks.sendNotification.mock.calls[0][0]
    expect(body).toBe('The Lookout is starting now.')
    for (const matcher of [...FORBIDDEN]) {
      expect(matcher.test(body)).toBe(false)
    }
  })
})

// ─── Once per row ────────────────────────────────────────────────────────────

describe('once per row, under a duplicate tick or a re-run (R9.7)', () => {
  it('claims each row before sending', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1'))
    const order: string[] = []
    mocks.claimGoingReminder.mockImplementation(async () => {
      order.push('claim')
      return true
    })
    mocks.sendNotification.mockImplementation(async () => {
      order.push('send')
      return { delivered: 'socket' }
    })

    await send()

    expect(order).toEqual(['claim', 'send'])
    expect(mocks.claimGoingReminder).toHaveBeenCalledWith({ userId: 'u1', nodeId: NODE_ID, date: NIGHT }, NOW)
  })

  it('sends nothing for a row another tick already claimed', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1', 'u2'))
    mocks.claimGoingReminder.mockImplementation(async (key: { userId: string }) => key.userId === 'u1')

    const outcome = await send()

    expect(outcome).toEqual({ candidates: 2, sent: 1, alreadyReminded: 1, failed: 0 })
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1)
    expect(mocks.sendNotification.mock.calls[0][0].userId).toBe('u1')
  })

  it('does not retry a claimed row whose delivery failed: one lost reminder beats a duplicate', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue(rows('u1', 'u2'))
    mocks.sendNotification.mockRejectedValueOnce(new Error('push gone'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const outcome = await send()

    expect(outcome).toEqual({ candidates: 2, sent: 1, alreadyReminded: 0, failed: 1 })
    // The failure is loud, not swallowed.
    expect(errSpy).toHaveBeenCalled()
    // Both rows were claimed, so no later tick can send to u1 twice.
    expect(mocks.claimGoingReminder).toHaveBeenCalledTimes(2)

    errSpy.mockRestore()
  })
})

// ─── Nothing to do ───────────────────────────────────────────────────────────

describe('a night nobody asked about costs nothing', () => {
  it('reads no venue and sends nothing when no row opted in', async () => {
    mocks.listGoingAwaitingReminder.mockResolvedValue([])

    const outcome = await send()

    expect(outcome).toEqual({ candidates: 0, sent: 0, alreadyReminded: 0, failed: 0 })
    expect(mocks.getNodeById).not.toHaveBeenCalled()
    expect(mocks.sendNotification).not.toHaveBeenCalled()
    expect(mocks.claimGoingReminder).not.toHaveBeenCalled()
  })

  it('scopes the row read to the one venue and the one night', async () => {
    await send()

    expect(mocks.listGoingAwaitingReminder).toHaveBeenCalledWith(NODE_ID, NIGHT, Math.floor(Date.parse(NOW) / 1000))
  })
})
