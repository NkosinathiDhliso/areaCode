/**
 * ActiveBoostList tests (billing-revenue-integrity R5.6).
 *
 * "Boost active until <time>" shows only for owned nodes with a currently
 * active Boost_Window (`boostUntil > now`), reverts with no residue once the
 * window passes (R5.5), and includes the date when the window ends on a later
 * day (honest overnight boost).
 */
// @vitest-environment jsdom
import type { Node } from '@area-code/shared/types'
import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { ActiveBoostList } from '../ActiveBoostList'

// 2026-07-09T12:00:00Z == 14:00 in Africa/Johannesburg (UTC+2).
const NOW = Date.parse('2026-07-09T12:00:00.000Z')

function node(overrides: Partial<Node>): Node {
  return { id: 'n1', name: 'Test Venue', ...overrides } as Node
}

describe('ActiveBoostList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when no node has an active boost', () => {
    const { container } = render(<ActiveBoostList nodes={[node({ boostUntil: null })]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows "Boost active until <time>" for a node with a future window', () => {
    // 16:00Z == 18:00 SAST, same SA day, so time-only.
    const { getByText } = render(
      <ActiveBoostList nodes={[node({ name: 'The Loft', boostUntil: '2026-07-09T16:00:00.000Z' })]} />,
    )
    expect(getByText('The Loft')).toBeTruthy()
    expect(getByText('Boost active until 18:00')).toBeTruthy()
  })

  it('does not show a node whose window has already passed (no residue)', () => {
    const { container } = render(<ActiveBoostList nodes={[node({ boostUntil: '2026-07-09T06:00:00.000Z' })]} />)
    expect(container.firstChild).toBeNull()
  })

  it('includes the date when the window ends on a later day', () => {
    // 2026-07-10T16:00Z == 18:00 SAST on 10 Jul, a different SA day than now.
    const { getByText } = render(<ActiveBoostList nodes={[node({ boostUntil: '2026-07-10T16:00:00.000Z' })]} />)
    expect(getByText('Boost active until 10 Jul 2026 18:00')).toBeTruthy()
  })

  it('shows only the active nodes when windows are mixed', () => {
    const { getByText, queryByText } = render(
      <ActiveBoostList
        nodes={[
          node({ id: 'a', name: 'Active Venue', boostUntil: '2026-07-09T16:00:00.000Z' }),
          node({ id: 'b', name: 'Expired Venue', boostUntil: '2026-07-09T06:00:00.000Z' }),
        ]}
      />,
    )
    expect(getByText('Active Venue')).toBeTruthy()
    expect(queryByText('Expired Venue')).toBeNull()
  })
})
