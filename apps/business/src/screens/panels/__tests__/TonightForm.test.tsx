// @vitest-environment jsdom
/**
 * TonightForm panel tests (proof-of-demand R8.1, R8.3, R8.4).
 *
 * Validates: Requirements 8.1, 8.3, 8.4
 *
 * The form publishes one Dated_Slot through the existing schedule upsert. These
 * tests pin the owner-facing contract: the date starts on tonight, the headline
 * limit is enforced before the request, the get picker offers live gets only,
 * submit writes a dated slot to the schedule endpoint, a server rejection is
 * shown as the API worded it, and the button is disabled while the call runs.
 */
import type { MusicSchedule, Reward } from '@area-code/shared/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string) => fallback ?? _key
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost },
}))

vi.mock('@area-code/shared/stores/businessAuthStore', () => ({
  useBusinessAuthStore: (selector: (s: { businessId: string | null }) => unknown) => selector({ businessId: 'biz-1' }),
}))

vi.mock('@area-code/shared/stores/businessStore', () => {
  // Stable reference, as the real store returns.
  const state = { nodes: [{ id: 'node-1', businessId: 'biz-1' }] }
  return {
    useBusinessStore: (selector: (s: typeof state) => unknown) => selector(state),
  }
})

vi.mock('@area-code/shared/components/Spinner', () => ({ Spinner: () => null }))

import { TonightForm } from '../TonightForm'

// ─── Fixtures ──────────────────────────────────────────────────────────────

const SCHEDULE_PATH = '/v1/business/biz-1/music-schedule'

/** Today in the venue's timezone, derived independently of the code under test. */
const TODAY_SAST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())

function schedule(slots: MusicSchedule['slots'] = []): MusicSchedule {
  return {
    businessId: 'biz-1',
    scheduleId: 'default',
    timezone: 'Africa/Johannesburg',
    slots,
    updatedAt: '2026-03-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

function get(overrides: Partial<Reward> = {}): Reward {
  return {
    id: 'get-live',
    nodeId: 'node-1',
    type: 'nth_checkin',
    title: 'Free coffee',
    description: null,
    triggerValue: 3,
    totalSlots: null,
    claimedCount: 0,
    slotsLocked: false,
    isActive: true,
    expiresAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

function seed(args: { schedule?: MusicSchedule | null; gets?: Reward[] } = {}) {
  mocks.apiGet.mockImplementation((path: string) => {
    if (path === SCHEDULE_PATH) {
      if (args.schedule === undefined || args.schedule === null) {
        return Promise.reject({ error: 'not_found', message: 'Music schedule not found', statusCode: 404 })
      }
      return Promise.resolve(args.schedule)
    }
    if (path === '/v1/business/rewards') return Promise.resolve({ items: args.gets ?? [] })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

async function renderForm(args: { schedule?: MusicSchedule | null; gets?: Reward[] } = {}) {
  seed(args)
  render(<TonightForm />)
  await waitFor(() => expect(screen.getByTestId('tonight-panel')).toBeTruthy())
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiPost.mockReset()
})

afterEach(() => {
  cleanup()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('TonightForm - date (R8.1, R8.3)', () => {
  it('defaults the date to today in the venue timezone and does not allow an earlier one', async () => {
    await renderForm({ schedule: schedule() })

    const date = screen.getByTestId('tonight-date') as HTMLInputElement
    expect(date.value).toBe(TODAY_SAST)
    expect(date.min).toBe(TODAY_SAST)
    // The publish horizon is bounded, so the owner cannot pick a date the API
    // would reject.
    expect(date.max.length).toBe(10)
    expect(date.max > TODAY_SAST).toBe(true)
  })
})

describe('TonightForm - headline limit (R8.1)', () => {
  it('caps the headline input and blocks publishing when the value exceeds the limit', async () => {
    await renderForm({ schedule: schedule() })

    const headline = screen.getByTestId('tonight-headline') as HTMLInputElement
    expect(headline.maxLength).toBe(60)

    fireEvent.change(headline, { target: { value: 'x'.repeat(61) } })

    expect(screen.getByTestId('tonight-error-headline').textContent).toContain('60')
    expect((screen.getByTestId('tonight-submit') as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.apiPost).not.toHaveBeenCalled()
  })
})

describe('TonightForm - featured get picker (R8.4)', () => {
  it('offers live gets only: a switched-off get and an ended get are absent', async () => {
    const ended = new Date(Date.now() - 60_000).toISOString()
    await renderForm({
      schedule: schedule(),
      gets: [
        get({ id: 'get-live', title: 'Free coffee' }),
        get({ id: 'get-off', title: 'Switched off', isActive: false }),
        get({ id: 'get-ended', title: 'Ended event', getCategory: 'event', endsAt: ended }),
        get({ id: 'get-expired', title: 'Expired loyalty', expiresAt: ended }),
      ],
    })

    const picker = screen.getByTestId('tonight-get') as HTMLSelectElement
    const values = Array.from(picker.options).map((o) => o.value)
    expect(values).toEqual(['', 'get-live'])
  })
})

describe('TonightForm - publish (R8.3)', () => {
  it('writes a dated slot through the schedule endpoint with the weekday derived from the date', async () => {
    await renderForm({ schedule: schedule(), gets: [get()] })

    fireEvent.change(screen.getByTestId('tonight-headline'), { target: { value: 'Amapiano all night' } })
    fireEvent.change(screen.getByTestId('tonight-start'), { target: { value: '21:00' } })
    fireEvent.change(screen.getByTestId('tonight-get'), { target: { value: 'get-live' } })

    mocks.apiPost.mockResolvedValue(schedule())
    await act(async () => {
      screen.getByTestId('tonight-submit').click()
    })

    expect(mocks.apiPost).toHaveBeenCalledTimes(1)
    const [path, body] = mocks.apiPost.mock.calls[0] as [string, MusicSchedule]
    expect(path).toBe(SCHEDULE_PATH)
    const slot = body.slots.find((s) => s.date === TODAY_SAST)
    expect(slot).toBeTruthy()
    expect(slot?.headline).toBe('Amapiano all night')
    expect(slot?.startTime).toBe('21:00')
    expect(slot?.featuredRewardId).toBe('get-live')
    // dayOfWeek is derived, never asked for.
    const expectedDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(`${TODAY_SAST}T00:00:00Z`))
      .toUpperCase()
    expect(slot?.dayOfWeek).toBe(expectedDay)
    expect(screen.getByTestId('tonight-saved')).toBeTruthy()
  })

  it('shows the reason the API gave when the publish is rejected', async () => {
    await renderForm({ schedule: schedule() })

    mocks.apiPost.mockRejectedValue({
      error: 'bad_request',
      message: 'That get is switched off. Turn it back on, or pick another one (get-off).',
      statusCode: 400,
    })
    await act(async () => {
      screen.getByTestId('tonight-submit').click()
    })

    expect(screen.getByTestId('tonight-server-error').textContent).toContain('That get is switched off')
    expect(screen.queryByTestId('tonight-saved')).toBeNull()
  })

  it('shows safe copy, not the server body, for a server failure', async () => {
    await renderForm({ schedule: schedule() })

    mocks.apiPost.mockRejectedValue({ error: 'internal', message: 'DynamoDB ProvisionedThroughput', statusCode: 500 })
    await act(async () => {
      screen.getByTestId('tonight-submit').click()
    })

    const text = screen.getByTestId('tonight-server-error').textContent ?? ''
    expect(text).not.toContain('DynamoDB')
    expect(text).toContain("Couldn't publish tonight")
  })

  it('disables the button while the publish is in flight', async () => {
    await renderForm({ schedule: schedule() })

    let resolvePost: ((value: MusicSchedule) => void) | null = null
    mocks.apiPost.mockReturnValue(
      new Promise<MusicSchedule>((resolve) => {
        resolvePost = resolve
      }),
    )

    const submit = screen.getByTestId('tonight-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await act(async () => {
      submit.click()
    })

    expect((screen.getByTestId('tonight-submit') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('tonight-submit').textContent).toContain('Publishing')

    // A second tap while in flight must not issue a second write.
    await act(async () => {
      screen.getByTestId('tonight-submit').click()
    })
    expect(mocks.apiPost).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePost?.(schedule())
    })
    await waitFor(() => expect((screen.getByTestId('tonight-submit') as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('TonightForm - a night that runs past midnight (decision 12)', () => {
  it('publishes 21:00 to 02:00 as one slot, the end human and the derived minute crossed', async () => {
    await renderForm({ schedule: schedule() })

    fireEvent.change(screen.getByTestId('tonight-start'), { target: { value: '21:00' } })
    fireEvent.change(screen.getByTestId('tonight-end'), { target: { value: '02:00' } })

    expect((screen.getByTestId('tonight-submit') as HTMLButtonElement).disabled).toBe(false)

    mocks.apiPost.mockResolvedValue(schedule())
    await act(async () => {
      screen.getByTestId('tonight-submit').click()
    })

    const [, body] = mocks.apiPost.mock.calls[0] as [string, MusicSchedule]
    expect(body.slots).toHaveLength(1)
    const slot = body.slots[0]!
    expect(slot.date).toBe(TODAY_SAST)
    expect(slot.startTime).toBe('21:00')
    expect(slot.endTime).toBe('02:00')
    expect(slot.endTimeMin).toBeGreaterThan(1439)
    expect(slot.endTimeMin).toBe(26 * 60)
  })

  it('states the real span when the end is at or before the start, and not otherwise', async () => {
    await renderForm({ schedule: schedule() })

    fireEvent.change(screen.getByTestId('tonight-start'), { target: { value: '21:00' } })
    fireEvent.change(screen.getByTestId('tonight-end'), { target: { value: '02:00' } })

    const note = screen.getByTestId('tonight-cross-midnight').textContent ?? ''
    expect(note).toContain('past midnight')
    expect(note).toContain('02:00')
    expect(note).toContain('following morning')

    // A night that ends the same evening says nothing extra.
    fireEvent.change(screen.getByTestId('tonight-end'), { target: { value: '23:00' } })
    expect(screen.queryByTestId('tonight-cross-midnight')).toBeNull()
  })

  it('rejects an end past the 04:00 rollover against the time field and blocks publishing', async () => {
    await renderForm({ schedule: schedule() })

    fireEvent.change(screen.getByTestId('tonight-start'), { target: { value: '21:00' } })
    fireEvent.change(screen.getByTestId('tonight-end'), { target: { value: '05:00' } })

    expect(screen.getByTestId('tonight-error-time').textContent).toContain('04:00')
    expect((screen.getByTestId('tonight-submit') as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.apiPost).not.toHaveBeenCalled()
  })

  it('publishes a same-evening night exactly as before', async () => {
    await renderForm({ schedule: schedule() })

    fireEvent.change(screen.getByTestId('tonight-start'), { target: { value: '20:00' } })
    fireEvent.change(screen.getByTestId('tonight-end'), { target: { value: '23:00' } })

    mocks.apiPost.mockResolvedValue(schedule())
    await act(async () => {
      screen.getByTestId('tonight-submit').click()
    })

    const [, body] = mocks.apiPost.mock.calls[0] as [string, MusicSchedule]
    expect(body.slots).toHaveLength(1)
    expect(body.slots[0]!.endTime).toBe('23:00')
    expect(body.slots[0]!.endTimeMin).toBe(23 * 60)
    expect(screen.queryByTestId('tonight-cross-midnight')).toBeNull()
    expect(screen.getByTestId('tonight-saved')).toBeTruthy()
  })
})

describe('TonightForm - no schedule yet (R8.3)', () => {
  it('starts from an empty schedule when the venue has none, rather than failing', async () => {
    await renderForm({ schedule: null })

    expect((screen.getByTestId('tonight-date') as HTMLInputElement).value).toBe(TODAY_SAST)

    mocks.apiPost.mockResolvedValue(schedule())
    await act(async () => {
      screen.getByTestId('tonight-submit').click()
    })

    const [, body] = mocks.apiPost.mock.calls[0] as [string, MusicSchedule]
    expect(body.businessId).toBe('biz-1')
    expect(body.slots).toHaveLength(1)
  })
})
