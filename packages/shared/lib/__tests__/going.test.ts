/**
 * Going client and threshold copy (proof-of-demand task 10.3, R9.2, R9.3).
 *
 * Validates: Requirements 9.2, 9.3
 *
 * Two things are locked here. First the surfacing rule: a consumer is told a
 * Going number only at or above the Going_Threshold and only when the venue has a
 * Tonight, so the venue card and the detail block cannot disagree about whether
 * tonight has momentum. Second the wire: the toggle posts nothing but the venue in
 * the path, and the withdraw names the night it is undoing.
 *
 * `Feature: Proof of demand, Property 8: Going threshold copy, count shown iff
 * >= threshold`
 *
 * The api client is mocked; nothing else is. No network.
 */
import fc from 'fast-check'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GOING_PUBLIC_THRESHOLD } from '../../constants/attribution'
import { goingCountToShow, goingPrompt, markGoing, readGoingState, unmarkGoing } from '../going'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

vi.mock('../api', () => ({ api: { get: mocks.get, post: mocks.post, delete: mocks.del } }))

const NODE_ID = 'node-ramona'

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.del.mockReset()
})

// ─── The surfacing rule ──────────────────────────────────────────────────────

describe('goingCountToShow (R9.2)', () => {
  it('names the count at the threshold', () => {
    expect(goingCountToShow(GOING_PUBLIC_THRESHOLD, true)).toBe(GOING_PUBLIC_THRESHOLD)
  })

  it('says nothing one below the threshold', () => {
    expect(goingCountToShow(GOING_PUBLIC_THRESHOLD - 1, true)).toBeNull()
  })

  it('says nothing without a Tonight, however many marked', () => {
    expect(goingCountToShow(GOING_PUBLIC_THRESHOLD + 40, false)).toBeNull()
  })

  it('says nothing for a count nobody measured', () => {
    expect(goingCountToShow(null, true)).toBeNull()
    expect(goingCountToShow(undefined, true)).toBeNull()
    expect(goingCountToShow(Number.NaN, true)).toBeNull()
  })
})

describe('Feature: Proof of demand, Property 8: Going threshold copy', () => {
  it('names a count exactly when a Tonight exists and the count is at or above the threshold', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 60 }), fc.boolean(), (goingCount, hasTonight) => {
        const shown = goingCountToShow(goingCount, hasTonight)
        const allowed = hasTonight && goingCount >= GOING_PUBLIC_THRESHOLD

        expect(shown === null).toBe(!allowed)
        // When it is named it is the measured number, never a rounded-up or
        // softened one.
        if (shown !== null) expect(shown).toBe(goingCount)
      }),
      { numRuns: 200 },
    )
  })

  it('never claims "be the first" without a Tonight, and never once somebody has marked', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.boolean(),
        fc.boolean(),
        (goingCount, hasTonight, viewerGoing) => {
          const prompt = goingPrompt({ goingCount, hasTonight, viewerGoing })

          if (prompt === 'be_first') {
            expect(hasTonight).toBe(true)
            expect(goingCount).toBe(0)
            expect(viewerGoing).toBe(false)
          }
          // A consumer who marked always reads as marked, never as an invitation.
          if (viewerGoing) expect(prompt).toBe('marked')
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('goingPrompt (R9.2, R9.3)', () => {
  it('invites the first mark when a night is published and nobody has marked', () => {
    expect(goingPrompt({ goingCount: 0, hasTonight: true, viewerGoing: false })).toBe('be_first')
  })

  it('drops the first-mark claim once somebody else has marked, even below the threshold', () => {
    expect(goingPrompt({ goingCount: 2, hasTonight: true, viewerGoing: false })).toBe('mark_going')
  })

  it('offers the plain invitation when nothing is published', () => {
    expect(goingPrompt({ goingCount: 0, hasTonight: false, viewerGoing: false })).toBe('mark_going')
  })

  it('says nothing about the count it cannot read', () => {
    expect(goingPrompt({ goingCount: null, hasTonight: true, viewerGoing: false })).toBe('mark_going')
  })
})

// ─── The wire ────────────────────────────────────────────────────────────────

describe('the Going calls (R9.1)', () => {
  it('marks going without naming a night, leaving the rollover to the server', async () => {
    mocks.post.mockResolvedValue({ date: '2026-03-06', goingCount: 4, viewerGoing: true })

    await expect(markGoing(NODE_ID)).resolves.toEqual({ date: '2026-03-06', goingCount: 4, viewerGoing: true })
    expect(mocks.post).toHaveBeenCalledWith(`/v1/nodes/${NODE_ID}/going`, {})
  })

  it('withdraws against the night the mark landed on', async () => {
    mocks.del.mockResolvedValue({ date: '2026-03-06', goingCount: 3, viewerGoing: false })

    await unmarkGoing(NODE_ID, '2026-03-06')

    expect(mocks.del).toHaveBeenCalledWith(`/v1/nodes/${NODE_ID}/going?date=2026-03-06`)
  })

  it('withdraws without a night when the caller does not know which one', async () => {
    mocks.del.mockResolvedValue({ date: '2026-03-06', goingCount: 3, viewerGoing: false })

    await unmarkGoing(NODE_ID)

    expect(mocks.del).toHaveBeenCalledWith(`/v1/nodes/${NODE_ID}/going`)
  })

  it('surfaces a failed toggle rather than swallowing it', async () => {
    mocks.post.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 429 }))

    await expect(markGoing(NODE_ID)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('reads the viewer pair from the one authoritative venue read', async () => {
    mocks.get.mockResolvedValue({ goingCount: 5, viewerGoing: true, name: 'Ramona' })

    await expect(readGoingState(NODE_ID)).resolves.toEqual({ goingCount: 5, viewerGoing: true })
    expect(mocks.get).toHaveBeenCalledWith(`/v1/nodes/${NODE_ID}/detail`)
  })

  it('reports an anonymous read as a count with no viewer mark', async () => {
    mocks.get.mockResolvedValue({ goingCount: 5 })

    await expect(readGoingState(NODE_ID)).resolves.toEqual({ goingCount: 5, viewerGoing: undefined })
  })
})
