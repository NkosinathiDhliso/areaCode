// @vitest-environment jsdom
import { useSelectionStore } from '@area-code/shared/stores/selectionStore'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FlickControls } from '../FlickControls'

/**
 * Map Discovery - Flick_Controls keyboard/operability tests (part of task 11.3).
 *
 * The previous/next controls are native buttons with accessible labels and step
 * the single Selection_Model via `selectionStore.step`, wrapping at the ends.
 *
 * Validates: Requirements 8.1, 8.2, 8.6, 1.6, 3.2, 3.3
 */

function reset(): void {
  useSelectionStore.setState({
    activeVenueId: null,
    mode: 'closed',
    carouselOrder: [],
    openedFromFocus: false,
    lastVenueId: null,
  })
}

beforeEach(reset)
afterEach(cleanup)

describe('FlickControls', () => {
  it('renders previous/next buttons with accessible labels', () => {
    render(<FlickControls />)
    expect(screen.getByRole('button', { name: 'Previous venue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next venue' })).toBeTruthy()
  })

  it('steps the Active_Venue forward and backward through the Carousel_Order', () => {
    const store = useSelectionStore.getState()
    store.setOrder(['a', 'b', 'c'])
    store.selectVenue('a', 'marker')
    render(<FlickControls />)

    fireEvent.click(screen.getByRole('button', { name: 'Next venue' }))
    expect(useSelectionStore.getState().activeVenueId).toBe('b')

    fireEvent.click(screen.getByRole('button', { name: 'Previous venue' }))
    expect(useSelectionStore.getState().activeVenueId).toBe('a')
  })

  it('wraps from the first card back to the last', () => {
    const store = useSelectionStore.getState()
    store.setOrder(['a', 'b'])
    store.selectVenue('a', 'marker')
    render(<FlickControls />)

    fireEvent.click(screen.getByRole('button', { name: 'Previous venue' }))
    expect(useSelectionStore.getState().activeVenueId).toBe('b')
  })

  it('renders disabled controls when there is nowhere to step', () => {
    render(<FlickControls disabled />)
    expect((screen.getByRole('button', { name: 'Previous venue' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Next venue' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
