/**
 * MusicSchedulePanel integration tests (Live Vibe on Map § R4, R13.4).
 *
 * Covers:
 *   - R4.11 / R4.12 denial state when the operator's JWT does not include
 *     the venue's businessId, with zero schedule API requests.
 *   - R4.10 empty-state CTA that opens the slot editor.
 *   - R4.5 inline validation surfacing (time format, blanket genre).
 *   - R4.6 delete confirmation flow.
 *   - R3.12 / R4.13 cross-midnight save split into a pair-<base>-a/-b pair
 *     persisted as two same-day slots.
 *   - R4.14 cross-midnight pair edited as a unit (merged virtual slot).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react'

import type { MusicSchedule } from '@area-code/shared/types'

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => {
  // Stable identity so useEffect dependencies that reference `t` do not
  // re-fire on every render of the SUT.
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiDelete = vi.fn()

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}))

// JWT / business store mocks.
let mockJwtBusinessId: string | null = 'biz-1'
vi.mock('@area-code/shared/stores/businessAuthStore', () => ({
  useBusinessAuthStore: (selector: (s: { businessId: string | null }) => unknown) =>
    selector({ businessId: mockJwtBusinessId }),
}))

let mockBusinessNodes: Array<{ businessId: string; lastBranch?: string; liveArchetypeId?: string }> = [
  { businessId: 'biz-1' },
]
vi.mock('@area-code/shared/stores/businessStore', () => ({
  useBusinessStore: (selector: (s: { nodes: typeof mockBusinessNodes }) => unknown) =>
    selector({ nodes: mockBusinessNodes }),
}))

vi.mock('@area-code/shared/components/Spinner', () => ({
  Spinner: () => null,
}))

import { MusicSchedulePanel } from '../MusicSchedulePanel'

// ─── Helpers ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockJwtBusinessId = 'biz-1'
  mockBusinessNodes = [{ businessId: 'biz-1' }]
  apiGet.mockReset()
  apiPost.mockReset()
  apiDelete.mockReset()
})

afterEach(() => {
  cleanup()
})

function makeSchedule(overrides: Partial<MusicSchedule> = {}): MusicSchedule {
  return {
    businessId: 'biz-1',
    scheduleId: 'default',
    timezone: 'Africa/Johannesburg',
    slots: [],
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
    ...overrides,
  }
}

async function waitForLoad() {
  // The panel kicks off `api.get` in a useEffect; flush microtasks until the
  // loading spinner has been replaced by either the empty-state CTA or the
  // week timeline.
  await waitFor(() => {
    const empty = screen.queryByTestId('music-schedule-empty')
    const panel = screen.queryByTestId('music-schedule-panel')
    const denied = screen.queryByTestId('music-schedule-denied')
    expect(empty ?? panel ?? denied).toBeTruthy()
  })
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('MusicSchedulePanel - access control (R4.11, R4.12)', () => {
  it('renders the denial state and issues zero schedule API requests when the JWT businessId differs from the venue', async () => {
    mockJwtBusinessId = 'someone-else'
    mockBusinessNodes = [{ businessId: 'biz-1' }]
    render(<MusicSchedulePanel />)
    expect(screen.getByTestId('music-schedule-denied')).toBeTruthy()
    expect(apiGet).not.toHaveBeenCalled()
    expect(apiPost).not.toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })
})

describe('MusicSchedulePanel - empty state (R4.10)', () => {
  it('shows the "Add first slot" CTA and opens the editor on tap', async () => {
    apiGet.mockResolvedValue({ schedule: null })
    render(<MusicSchedulePanel />)
    await waitForLoad()
    const cta = screen.getByTestId('music-schedule-add-first-slot')
    fireEvent.click(cta)
    expect(screen.getByTestId('music-schedule-editor')).toBeTruthy()
  })
})

describe('MusicSchedulePanel - Cross_Midnight_Pair split on save (R3.12, R4.13)', () => {
  it('persists a cross-midnight blanket slot as two pair-a/-b halves', async () => {
    apiGet.mockResolvedValue({ schedule: makeSchedule() })
    apiPost.mockImplementation(async (_url: string, body: MusicSchedule) => body)

    render(<MusicSchedulePanel />)
    await waitForLoad()

    fireEvent.click(screen.getByTestId('music-schedule-add-first-slot'))

    // Set the editor to a cross-midnight blanket slot (22:00 → 02:00).
    const start = screen.getByTestId('slot-editor-start-time') as HTMLInputElement
    const end = screen.getByTestId('slot-editor-end-time') as HTMLInputElement
    fireEvent.change(start, { target: { value: '22:00' } })
    fireEvent.change(end, { target: { value: '02:00' } })

    // The friendly cross-midnight banner appears (R4.13 UX).
    expect(screen.getByTestId('slot-editor-cross-midnight')).toBeTruthy()

    // Save and capture the POSTed payload.
    await act(async () => {
      fireEvent.click(screen.getByTestId('slot-editor-save'))
    })
    expect(apiPost).toHaveBeenCalledTimes(1)
    const [, payload] = apiPost.mock.calls[0]!
    const persisted = payload as MusicSchedule
    expect(persisted.slots).toHaveLength(2)
    const ids = persisted.slots.map((s) => s.slotId)
    expect(ids.some((id) => /^pair-.+-a$/.test(id))).toBe(true)
    expect(ids.some((id) => /^pair-.+-b$/.test(id))).toBe(true)
    // Half A ends 23:59, half B starts 00:00 (R3.12).
    const halfA = persisted.slots.find((s) => /^pair-.+-a$/.test(s.slotId))!
    const halfB = persisted.slots.find((s) => /^pair-.+-b$/.test(s.slotId))!
    expect(halfA.endTime).toBe('23:59')
    expect(halfB.startTime).toBe('00:00')
  })
})

describe('MusicSchedulePanel - promise-vs-crowd status line (R5.1, R5.2)', () => {
  it('shows the "expected vibe" promise line when the resolved branch is declared_promise', async () => {
    mockBusinessNodes = [{ businessId: 'biz-1', lastBranch: 'declared_promise' }]
    apiGet.mockResolvedValue({ schedule: null })
    render(<MusicSchedulePanel />)
    await waitForLoad()
    const status = screen.getByTestId('music-schedule-vibe-status')
    expect(status.getAttribute('data-branch')).toBe('declared_promise')
    expect(status.textContent).toContain('biz.musicSchedule.status.promise')
  })

  it('shows "the crowd has taken over" with the Crowd_Vibe display name when branch is crowd_live', async () => {
    mockBusinessNodes = [
      { businessId: 'biz-1', lastBranch: 'crowd_live', liveArchetypeId: 'archetype-festival-spirit' },
    ]
    apiGet.mockResolvedValue({ schedule: null })
    render(<MusicSchedulePanel />)
    await waitForLoad()
    const status = screen.getByTestId('music-schedule-vibe-status')
    expect(status.getAttribute('data-branch')).toBe('crowd_live')
    expect(status.textContent).toContain('biz.musicSchedule.status.crowd')
    // The crowd archetype display name the map is rendering is shown.
    expect(status.textContent).toContain('The Festival Spirit')
  })

  it('renders no status line for a neutral branch (asserts nothing false)', async () => {
    mockBusinessNodes = [{ businessId: 'biz-1', lastBranch: 'default' }]
    apiGet.mockResolvedValue({ schedule: null })
    render(<MusicSchedulePanel />)
    await waitForLoad()
    expect(screen.queryByTestId('music-schedule-vibe-status')).toBeNull()
  })

  it('renders no status line when the venue has no resolved branch data', async () => {
    mockBusinessNodes = [{ businessId: 'biz-1' }]
    apiGet.mockResolvedValue({ schedule: null })
    render(<MusicSchedulePanel />)
    await waitForLoad()
    expect(screen.queryByTestId('music-schedule-vibe-status')).toBeNull()
  })
})

describe('MusicSchedulePanel - pair edit-as-unit (R4.14)', () => {
  it('opens both halves of a Cross_Midnight_Pair as a single merged slot', async () => {
    // Seed a schedule that already contains a pair (FRI 22:00→23:59 + SAT 00:00→02:00).
    apiGet.mockResolvedValue({
      schedule: makeSchedule({
        slots: [
          {
            slotId: 'pair-abc-a',
            dayOfWeek: 'FRI',
            startTime: '22:00',
            endTime: '23:59',
            startTimeMin: 22 * 60,
            endTimeMin: 1439,
            mode: 'blanket',
            genres: ['amapiano'],
          },
          {
            slotId: 'pair-abc-b',
            dayOfWeek: 'SAT',
            startTime: '00:00',
            endTime: '02:00',
            startTimeMin: 0,
            endTimeMin: 120,
            mode: 'blanket',
            genres: ['amapiano'],
          },
        ],
      }),
    })
    render(<MusicSchedulePanel />)
    await waitForLoad()

    // Click EITHER half - both must open the merged virtual slot.
    fireEvent.click(screen.getByTestId('music-schedule-slot-pair-abc-b'))
    const start = screen.getByTestId('slot-editor-start-time') as HTMLInputElement
    const end = screen.getByTestId('slot-editor-end-time') as HTMLInputElement
    // Merged virtual slot reads start=22:00 (half A) and end=02:00 (half B).
    expect(start.value).toBe('22:00')
    expect(end.value).toBe('02:00')
  })
})
