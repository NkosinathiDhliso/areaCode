// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { PhotoUnavailable } from '../PhotoUnavailable'

// PhotoUnavailable is the explicit "unavailable" state a photo surface shows
// when a media key exists but no serving URL could be resolved (VITE_CDN_URL
// unset). It must never look like a silent success (deployment-parity R5.3).

describe('PhotoUnavailable - full variant', () => {
  it('renders an accessible image role labelled "Photos unavailable"', () => {
    const { getByRole } = render(<PhotoUnavailable />)
    const el = getByRole('img', { name: 'Photos unavailable' })
    expect(el).toBeTruthy()
  })

  it('shows explicit copy so the state is never mistaken for success', () => {
    const { container } = render(<PhotoUnavailable />)
    expect(container.textContent).toContain('Photos unavailable')
    expect(container.textContent).toContain('Photo serving is not configured right now.')
  })

  it('applies the caller sizing classes to the slot', () => {
    const { getByRole } = render(<PhotoUnavailable className="w-full h-40 mb-4" />)
    const el = getByRole('img', { name: 'Photos unavailable' })
    expect(el.className).toContain('w-full')
    expect(el.className).toContain('h-40')
    expect(el.className).toContain('mb-4')
  })
})

describe('PhotoUnavailable - compact variant', () => {
  it('renders the accessible image role with no body copy', () => {
    const { getByRole, container } = render(<PhotoUnavailable variant="compact" />)
    expect(getByRole('img', { name: 'Photos unavailable' })).toBeTruthy()
    // Compact is icon-only: no descriptive copy.
    expect(container.textContent).not.toContain('Photos unavailable')
    expect(container.textContent).not.toContain('Photo serving is not configured right now.')
  })
})
