// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { CountdownBadge } from '../CountdownBadge'

const NOW = Date.parse('2026-05-16T12:00:00Z')

describe('CountdownBadge', () => {
  it('renders nothing when expiresAt is null', () => {
    const { container } = render(<CountdownBadge expiresAt={null} nowMs={NOW} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when more than 7 days away', () => {
    const eightDays = new Date(NOW + 8 * 24 * 60 * 60 * 1000).toISOString()
    const { container } = render(<CountdownBadge expiresAt={eightDays} nowMs={NOW} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders yellow tone with day countdown when 3 days away', () => {
    const t = new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { getByTestId } = render(<CountdownBadge expiresAt={t} nowMs={NOW} />)
    const badge = getByTestId('countdown-badge')
    expect(badge.textContent).toContain('3d')
    expect(badge.className).toContain('warning')
  })

  it('renders red tone with hour countdown when under 24h', () => {
    const t = new Date(NOW + 4 * 60 * 60 * 1000).toISOString()
    const { getByTestId } = render(<CountdownBadge expiresAt={t} nowMs={NOW} />)
    const badge = getByTestId('countdown-badge')
    expect(badge.textContent).toContain('4h')
    expect(badge.className).toContain('danger')
  })

  it('renders minute countdown when under 1h', () => {
    const t = new Date(NOW + 30 * 60 * 1000).toISOString()
    const { getByTestId } = render(<CountdownBadge expiresAt={t} nowMs={NOW} />)
    expect(getByTestId('countdown-badge').textContent).toContain('30m')
  })

  it('renders Missed when expiresAt is in the past', () => {
    const t = new Date(NOW - 60 * 1000).toISOString()
    const { getByTestId } = render(<CountdownBadge expiresAt={t} nowMs={NOW} />)
    expect(getByTestId('countdown-badge').textContent).toBe('Missed')
  })
})
