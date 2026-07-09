// @vitest-environment jsdom
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ParkedCheckinsSection } from '../ParkedCheckinsSection'
import type { OutboxEntry } from '../../lib/checkinOutbox'
import { useCheckinOutboxStore } from '../../stores/checkinOutboxStore'

/**
 * Parked check-in failures section (cross-portal-lifecycle-alignment task 6.4,
 * R5.6). Renders parked entries with retry and discard actions. A retry inside
 * the Replay_Window re-queues the entry (it leaves the parked list); a retry that
 * has aged out is discarded with an honest message; discard removes it outright.
 */

function parkedEntry(id: string, capturedAt: string): OutboxEntry {
  return {
    id,
    nodeId: `node-${id}`,
    type: 'reward',
    capturedAt,
    lat: -33.9,
    lng: 18.4,
    retryCount: 3,
    nextAttemptAt: capturedAt,
    parkedAt: capturedAt,
  }
}

describe('ParkedCheckinsSection (R5.6)', () => {
  beforeEach(() => {
    useCheckinOutboxStore.setState({ entries: [] })
  })
  afterEach(() => {
    cleanup()
    useCheckinOutboxStore.setState({ entries: [] })
  })

  it('renders nothing when there are no parked entries', () => {
    const { container } = render(<ParkedCheckinsSection />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a parked entry with retry and discard actions', () => {
    useCheckinOutboxStore.setState({ entries: [parkedEntry('1', new Date().toISOString())] })
    const { getByText, getAllByText } = render(<ParkedCheckinsSection />)
    expect(getByText('Check-in not sent')).toBeTruthy()
    expect(getAllByText('Retry')).toHaveLength(1)
    expect(getAllByText('Discard')).toHaveLength(1)
  })

  it('discard removes the entry from the store', () => {
    useCheckinOutboxStore.setState({ entries: [parkedEntry('1', new Date().toISOString())] })
    const { getByText } = render(<ParkedCheckinsSection />)
    fireEvent.click(getByText('Discard'))
    expect(useCheckinOutboxStore.getState().entries).toHaveLength(0)
  })

  it('retry inside the Replay_Window re-queues the entry (leaves the parked list)', () => {
    useCheckinOutboxStore.setState({ entries: [parkedEntry('1', new Date().toISOString())] })
    const { getByText } = render(<ParkedCheckinsSection />)
    fireEvent.click(getByText('Retry'))
    const entries = useCheckinOutboxStore.getState().entries
    expect(entries).toHaveLength(1)
    // Re-queued: no longer parked, retry budget reset.
    expect(entries[0]!.parkedAt).toBeUndefined()
    expect(entries[0]!.retryCount).toBe(0)
  })

  it('retry on an aged-out entry discards it with an honest message', () => {
    const showError = vi.fn()
    useErrorStore.setState({ showError } as never)
    // Captured 20 minutes ago — past the 15-minute Replay_Window.
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    useCheckinOutboxStore.setState({ entries: [parkedEntry('1', old)] })
    const { getByText } = render(<ParkedCheckinsSection />)
    fireEvent.click(getByText('Retry'))
    expect(useCheckinOutboxStore.getState().entries).toHaveLength(0)
    expect(showError).toHaveBeenCalledOnce()
  })
})
