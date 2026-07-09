/**
 * Staff polish (item E) — leaderboard renders rank without emoji.
 *
 * `MyRank` must convey rank using text (`#{n}`) and the current-user accent
 * only, with no emoji code points in system UI (code-style.md).
 *
 * **Validates: Requirements 5.2**
 */
// @vitest-environment jsdom
import { render, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn()

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

vi.mock('../../stores/staffAuthStore', () => ({
  useStaffAuthStore: (selector: (s: { staffId: string | null }) => unknown) => selector({ staffId: 'staff-1' }),
}))

import { MyRank } from '../MyRank'

// ─── Fixtures ───────────────────────────────────────────────────────────────

function entry(staffId: string, staffName: string, redemptions: number) {
  return {
    staffId,
    staffName,
    redemptions,
    prevRedemptions: 0,
    delta: redemptions,
    attributedReturnVisits: 0,
    uniqueConsumersServed: redemptions,
  }
}

const payload = {
  period: 'week' as const,
  entries: [entry('staff-2', 'Alice', 12), entry('staff-1', 'Bob', 8), entry('staff-3', 'Cara', 4)],
  generatedAt: new Date().toISOString(),
}

// Detects any emoji / pictographic code point.
const EMOJI_RE = /\p{Extended_Pictographic}/u

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MyRank — no emoji in rendered leaderboard (R5.2)', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the top 3 by rank number with no emoji code points', async () => {
    mockApiGet.mockResolvedValue(payload)

    const { container } = render(<MyRank />)

    await waitFor(() => {
      expect(container.textContent).toContain('Alice')
    })

    // Ranks are conveyed by text, not medals.
    expect(container.textContent).toContain('#1')
    expect(container.textContent).toContain('#2')
    expect(container.textContent).toContain('#3')

    // No medal or any other emoji anywhere in the rendered widget.
    expect(EMOJI_RE.test(container.textContent ?? '')).toBe(false)
    for (const medal of ['🥇', '🥈', '🥉']) {
      expect(container.textContent ?? '').not.toContain(medal)
    }
  })
})
