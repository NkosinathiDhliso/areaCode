/**
 * Repeat_Policy control tests (loyalty-repeat-redemption R6.1, R6.2, R6.4).
 *
 * Covers the standalone control (both options, default, slot copy) and its
 * wiring into the get create form (shown only for loyalty nth_checkin, hidden
 * for event/offer, sends repeatPolicy in the create body).
 */
// @vitest-environment jsdom
import { render, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { RepeatPolicyControl } from '../RepeatPolicyControl'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const mockApiGet = vi.fn()
const mockApiPost = vi.fn()
const mockApiPut = vi.fn()

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
  },
}))

const mockSetPanel = vi.fn()
vi.mock('@area-code/shared/stores/businessStore', () => ({
  useBusinessStore: (selector?: (state: any) => any) => {
    const state = { setPanel: mockSetPanel }
    return selector ? selector(state) : state
  },
}))

vi.mock('@area-code/shared/stores/errorStore', () => ({
  useErrorStore: { getState: () => ({ showError: vi.fn() }) },
}))

const REPEAT_COPY = 'Regulars can earn this again each visit, at least 4 hours after their last redemption.'
const SLOT_COPY = 'Slots count total redemptions including repeats, not distinct customers.'

describe('RepeatPolicyControl', () => {
  it('renders both options with the exact repeat copy and no unlimited claim', () => {
    const { container } = render(
      <RepeatPolicyControl value="once" onChange={() => {}} disabled={false} slotsSet={false} />,
    )
    expect(container.textContent).toContain('One per customer')
    expect(container.textContent).toContain(REPEAT_COPY)
    expect(container.textContent?.toLowerCase()).not.toContain('unlimited')
  })

  it('marks the selected option via aria-checked', () => {
    const { getByRole } = render(
      <RepeatPolicyControl value="per_visit" onChange={() => {}} disabled={false} slotsSet={false} />,
    )
    const perVisit = getByRole('radio', { checked: true })
    expect(perVisit.textContent).toContain('Repeats each visit')
  })

  it('fires onChange with the chosen policy value', () => {
    const onChange = vi.fn()
    const { getByRole } = render(
      <RepeatPolicyControl value="once" onChange={onChange} disabled={false} slotsSet={false} />,
    )
    fireEvent.click(getByRole('radio', { checked: false }))
    expect(onChange).toHaveBeenCalledWith('per_visit')
  })

  it('shows the total-redemptions slot line only when per_visit and slots are set (R6.2)', () => {
    const base = { onChange: () => {}, disabled: false }
    const onceWithSlots = render(<RepeatPolicyControl value="once" slotsSet {...base} />)
    expect(onceWithSlots.container.textContent).not.toContain(SLOT_COPY)

    const perVisitNoSlots = render(<RepeatPolicyControl value="per_visit" slotsSet={false} {...base} />)
    expect(perVisitNoSlots.container.textContent).not.toContain(SLOT_COPY)

    const perVisitWithSlots = render(<RepeatPolicyControl value="per_visit" slotsSet {...base} />)
    expect(perVisitWithSlots.container.textContent).toContain(SLOT_COPY)
  })

  it('disables the options while an API call is in flight', () => {
    const { getAllByRole } = render(<RepeatPolicyControl value="once" onChange={() => {}} disabled slotsSet={false} />)
    for (const radio of getAllByRole('radio')) {
      expect((radio as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('RewardsPanel create form wiring', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockApiPost.mockReset()
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/v1/business/rewards') return Promise.resolve({ items: [] })
      if (url === '/v1/business/me/nodes') {
        return Promise.resolve({ items: [{ id: 'node-1', name: 'Venue' }] })
      }
      return Promise.resolve({})
    })
    mockApiPost.mockResolvedValue({})
  })

  async function renderPanel() {
    const { RewardsPanel } = await import('../RewardsPanel')
    const result = render(<RewardsPanel />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    return result
  }

  it('shows the repeat control for loyalty nth_checkin and hides it for events', async () => {
    const { container, getByLabelText } = await renderPanel()
    fireEvent.click(getByLabelText('biz.rewards.create'))

    expect(container.textContent).toContain(REPEAT_COPY)

    // Switch the category to event: the loyalty-only control disappears.
    fireEvent.change(getByLabelText('Get category'), { target: { value: 'event' } })
    expect(container.textContent).not.toContain(REPEAT_COPY)
  })

  it('sends repeatPolicy in the create body when per_visit is chosen', async () => {
    const { getByLabelText, getByPlaceholderText, getByRole } = await renderPanel()
    fireEvent.click(getByLabelText('biz.rewards.create'))

    fireEvent.change(getByPlaceholderText('Reward title'), { target: { value: 'Free coffee' } })
    fireEvent.click(getByRole('radio', { checked: false }))

    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Create Reward' }))
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(mockApiPost).toHaveBeenCalledWith(
      '/v1/business/rewards',
      expect.objectContaining({ repeatPolicy: 'per_visit', type: 'nth_checkin' }),
    )
  })
})
