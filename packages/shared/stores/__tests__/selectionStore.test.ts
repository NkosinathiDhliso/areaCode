import * as fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSelectionStore } from '../selectionStore'

/**
 * Map Discovery - Selection_Model store property tests (deferred tasks 6.2-6.4).
 *
 *   - Property 3: Single Active_Venue invariant
 *   - Property 4: Commit<->Browse preserves the Active_Venue
 *   - Property 5: Flick stepping wraps deterministically
 *
 * Validates: Requirements 1.3, 2.4, 2.6, 3.1, 3.2, 3.3
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

describe('Feature: map-discovery-experience, Property 3: Single Active_Venue invariant', () => {
  const idArb = fc.constantFrom('a', 'b', 'c', 'd')
  const opArb = fc.oneof(
    idArb.map((id) => ({ k: 'select' as const, id })),
    fc.constantFrom<1 | -1>(1, -1).map((dir) => ({ k: 'step' as const, dir })),
    fc.constant({ k: 'commit' as const }),
    fc.constant({ k: 'browse' as const }),
    fc.constant({ k: 'dismiss' as const }),
    fc.constant({ k: 'reopen' as const }),
    fc.constant({ k: 'toggle' as const }),
    fc.uniqueArray(idArb, { maxLength: 4 }).map((order) => ({ k: 'order' as const, order })),
  )

  it('keeps (the sheet is open) <=> (an Active_Venue is set) after any operation sequence', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        reset()
        for (const op of ops) {
          const s = useSelectionStore.getState()
          switch (op.k) {
            case 'select':
              s.selectVenue(op.id, 'marker')
              break
            case 'step':
              s.step(op.dir)
              break
            case 'commit':
              s.enterCommit()
              break
            case 'browse':
              s.enterBrowse()
              break
            case 'dismiss':
              s.dismiss()
              break
            case 'reopen':
              s.reopenLast()
              break
            case 'toggle':
              s.toggleOpen()
              break
            case 'order':
              s.setOrder(op.order)
              break
          }
          const st = useSelectionStore.getState()
          expect(['closed', 'constellation', 'browse', 'commit']).toContain(st.mode)
          expect(st.mode === 'closed').toBe(st.activeVenueId === null)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('Feature: map-discovery-experience, Property 4: Commit<->Browse preserves the Active_Venue', () => {
  it('never changes the Active_Venue across mode transitions', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 6 }), (id) => {
        reset()
        useSelectionStore.getState().selectVenue(id, 'marker')
        const active = useSelectionStore.getState().activeVenueId

        useSelectionStore.getState().enterCommit()
        expect(useSelectionStore.getState().mode).toBe('commit')
        expect(useSelectionStore.getState().activeVenueId).toBe(active)

        useSelectionStore.getState().enterBrowse()
        expect(useSelectionStore.getState().mode).toBe('browse')
        expect(useSelectionStore.getState().activeVenueId).toBe(active)
      }),
    )
  })
})

describe('Feature: map-discovery-experience, Property 5: Flick stepping wraps deterministically', () => {
  it('a full forward loop returns to the start and +1 then -1 is the identity', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 }),
        fc.nat(),
        (order, start) => {
          reset()
          const idx = start % order.length
          const store = useSelectionStore.getState()
          store.setOrder(order)
          store.selectVenue(order[idx]!, 'search')

          for (let i = 0; i < order.length; i++) useSelectionStore.getState().step(1)
          expect(useSelectionStore.getState().activeVenueId).toBe(order[idx])

          useSelectionStore.getState().step(1)
          useSelectionStore.getState().step(-1)
          expect(useSelectionStore.getState().activeVenueId).toBe(order[idx])
        },
      ),
    )
  })
})

describe('Feature: map-discovery-experience, toggleOpen (tab re-selection)', () => {
  it('closes when open, retaining the venue for re-open', () => {
    reset()
    const store = useSelectionStore.getState()
    store.setOrder(['a', 'b', 'c'])
    store.selectVenue('b', 'marker')
    expect(useSelectionStore.getState().mode).toBe('browse')

    useSelectionStore.getState().toggleOpen()
    expect(useSelectionStore.getState().mode).toBe('closed')
    expect(useSelectionStore.getState().activeVenueId).toBeNull()
    expect(useSelectionStore.getState().lastVenueId).toBe('b')
  })

  it('re-opens on the last venue when closed', () => {
    reset()
    const store = useSelectionStore.getState()
    store.setOrder(['a', 'b', 'c'])
    store.selectVenue('b', 'marker')
    useSelectionStore.getState().toggleOpen() // close

    useSelectionStore.getState().toggleOpen() // open
    expect(useSelectionStore.getState().mode).toBe('browse')
    expect(useSelectionStore.getState().activeVenueId).toBe('b')
    expect(useSelectionStore.getState().openedFromFocus).toBe(false)
  })

  it('falls back to the first venue in the order when there is no last venue', () => {
    reset()
    useSelectionStore.getState().setOrder(['x', 'y'])
    useSelectionStore.getState().toggleOpen()
    expect(useSelectionStore.getState().mode).toBe('browse')
    expect(useSelectionStore.getState().activeVenueId).toBe('x')
  })

  it('is a no-op when closed with nothing to open', () => {
    reset()
    useSelectionStore.getState().toggleOpen()
    expect(useSelectionStore.getState().mode).toBe('closed')
    expect(useSelectionStore.getState().activeVenueId).toBeNull()
  })
})

describe('Feature: map-discovery-experience, Property 5 (cont.)', () => {
  it('step is a no-op for an empty order or an Active_Venue absent from the order', () => {
    reset()
    const store = useSelectionStore.getState()
    store.setOrder([])
    store.selectVenue('x', 'marker')
    useSelectionStore.getState().step(1)
    expect(useSelectionStore.getState().activeVenueId).toBe('x')

    useSelectionStore.getState().setOrder(['a', 'b'])
    useSelectionStore.getState().step(1)
    expect(useSelectionStore.getState().activeVenueId).toBe('x')
  })
})
