/**
 * Unit tests for `CrowdVibeSection` honest promise-vs-now labelling
 * (live-vibe-declaration R6.1-R6.4, R11.1).
 *
 * The section heading is driven by the Resolution_Branch sourced from the SAME
 * live map data the glyph rides (`mapStore.archetypeBranches`), so the label
 * can never disagree with the rendered glyph:
 *   - `declared_promise` → "Expected tonight" (the venue's expectation, soft
 *     low-presence copy, never a crowd claim).
 *   - `crowd_live`       → "In the room now" (the real crowd).
 *   - any other branch / missing data → neutral "Crowd Vibe" heading.
 *
 * react-i18next is not initialised in unit tests, so `t(key)` returns the key
 * verbatim; we assert on the i18n keys, which is what renders.
 */
// @vitest-environment jsdom
import type { CrowdVibeSnapshot } from '@area-code/shared/types'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiGet = vi.fn()
vi.mock('@area-code/shared/lib/api', () => ({ api: { get: (url: string) => apiGet(url) } }))

import { useMapStore } from '@area-code/shared/stores/mapStore'

import { CrowdVibeSection } from '../CrowdVibeSection'

const NODE_ID = 'node-1'

// A snapshot with real crowd data so the section renders (it returns null when
// there is no music data at all).
const SNAPSHOT: CrowdVibeSnapshot = {
  totalCheckedIn: 5,
  genreCounts: { amapiano: 3 },
  archetypePercentages: { 'The Festival Spirit': 60 },
}

beforeEach(() => {
  apiGet.mockReset()
  apiGet.mockResolvedValue(SNAPSHOT)
  useMapStore.setState({ archetypeIds: {}, archetypeBranches: {} })
})

afterEach(() => {
  cleanup()
  useMapStore.setState({ archetypeIds: {}, archetypeBranches: {} })
})

describe('CrowdVibeSection promise-vs-now label', () => {
  it('labels a declared_promise branch as the venue expectation (R6.2)', async () => {
    useMapStore.setState({ archetypeBranches: { [NODE_ID]: 'declared_promise' } })
    render(<CrowdVibeSection nodeId={NODE_ID} />)
    await waitFor(() => expect(screen.getByText('crowdVibe.expectedTonight')).toBeTruthy())
    // It must not assert a present-tense crowd reading.
    expect(screen.queryByText('crowdVibe.inTheRoomNow')).toBeNull()
  })

  it('labels a crowd_live branch as the crowd in the room now (R6.3)', async () => {
    useMapStore.setState({ archetypeBranches: { [NODE_ID]: 'crowd_live' } })
    render(<CrowdVibeSection nodeId={NODE_ID} />)
    await waitFor(() => expect(screen.getByText('crowdVibe.inTheRoomNow')).toBeTruthy())
    expect(screen.queryByText('crowdVibe.expectedTonight')).toBeNull()
  })

  it('falls back to the neutral heading for other branches / missing data (R6.1)', async () => {
    // No branch stored for this node ⇒ neutral presentation, no crowd assertion.
    render(<CrowdVibeSection nodeId={NODE_ID} />)
    await waitFor(() => expect(screen.getByText('crowdVibe.title')).toBeTruthy())
    expect(screen.queryByText('crowdVibe.expectedTonight')).toBeNull()
    expect(screen.queryByText('crowdVibe.inTheRoomNow')).toBeNull()
  })

  it('falls back to neutral for a non-promise/non-crowd branch (e.g. schedule_blanket)', async () => {
    useMapStore.setState({ archetypeBranches: { [NODE_ID]: 'schedule_blanket' } })
    render(<CrowdVibeSection nodeId={NODE_ID} />)
    await waitFor(() => expect(screen.getByText('crowdVibe.title')).toBeTruthy())
  })
})
