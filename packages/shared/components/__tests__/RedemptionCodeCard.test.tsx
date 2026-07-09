// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { RedemptionCodeCard } from '../RedemptionCodeCard'

/**
 * Consumer wallet honesty (cross-portal-lifecycle-alignment R4). When a code's
 * venue is no longer active on Area Code, the card shows an honest secondary line
 * — the venue left, the code stays valid, staff can still scan — and never the
 * word "expired" while the code is still valid (R4.3). When the venue is active
 * (or the flag is absent, older payloads), the normal hint shows instead.
 */

const BASE = {
  rewardTitle: 'Free Coffee',
  redemptionCode: 'ABCD2345',
  nodeName: 'Father Coffee',
  codeExpiresAt: '2026-08-01T12:00:00.000Z',
}

describe('RedemptionCodeCard — lapsed-venue line (R4.1, R4.3)', () => {
  it('shows the honest lapsed line when venueActive is false', () => {
    const { container } = render(<RedemptionCodeCard {...BASE} venueActive={false} hint="Show this to staff." />)
    const text = container.textContent ?? ''
    expect(text).toContain('This venue has left Area Code')
    expect(text).toContain('staff can still scan it')
    // Avoids the word "expired" while the code is still valid (R4.3).
    expect(text.toLowerCase()).not.toContain('expired')
    // The normal hint is replaced, not shown alongside.
    expect(text).not.toContain('Show this to staff.')
  })

  it('shows the normal hint when the venue is active', () => {
    const { container } = render(<RedemptionCodeCard {...BASE} venueActive={true} hint="Show this to staff." />)
    const text = container.textContent ?? ''
    expect(text).toContain('Show this to staff.')
    expect(text).not.toContain('has left Area Code')
  })

  it('treats an absent venueActive flag as active (older payloads)', () => {
    const { container } = render(<RedemptionCodeCard {...BASE} hint="Show this to staff." />)
    const text = container.textContent ?? ''
    expect(text).toContain('Show this to staff.')
    expect(text).not.toContain('has left Area Code')
  })
})
