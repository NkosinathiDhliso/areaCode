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
    spotlightVenueId: null,
  })
}

beforeEach(reset)

describe('Feature: spotlight-mode, Property 3: Single Active_Venue invariant (+ spotlight I1/I2)', () => {
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
    idArb.map((id) => ({ k: 'enterSpotlight' as const, id })),
    fc.constant({ k: 'exitSpotlight' as const }),
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
            case 'enterSpotlight':
              s.enterSpotlight(op.id)
              break
            case 'exitSpotlight':
              s.exitSpotlight()
              break
          }
          const st = useSelectionStore.getState()
          expect(['closed', 'constellation', 'browse', 'commit']).toContain(st.mode)
          expect(st.mode === 'closed').toBe(st.activeVenueId === null)
          // Spotlight invariant I1 (R1.4): a closed carousel never leaves a
          // stale isolation.
          if (st.mode === 'closed') {
            expect(st.spotlightVenueId).toBeNull()
          }
          // Spotlight invariant I2 (R1.5): a set spotlight always tracks the
          // Active_Venue.
          if (st.spotlightVenueId !== null) {
            expect(st.spotlightVenueId).toBe(st.activeVenueId)
          }
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

describe('Feature: spotlight-mode, spotlight actions (R1.1-R1.5)', () => {
  it('exitSpotlight preserves the selection (only the isolation lifts)', () => {
    reset()
    const store = useSelectionStore.getState()
    store.setOrder(['a', 'b', 'c'])
    store.enterSpotlight('b')
    expect(useSelectionStore.getState().spotlightVenueId).toBe('b')
    expect(useSelectionStore.getState().activeVenueId).toBe('b')
    expect(useSelectionStore.getState().mode).toBe('browse')

    useSelectionStore.getState().exitSpotlight()
    expect(useSelectionStore.getState().spotlightVenueId).toBeNull()
    expect(useSelectionStore.getState().activeVenueId).toBe('b')
    expect(useSelectionStore.getState().mode).toBe('browse')
    expect(useSelectionStore.getState().lastVenueId).toBe('b')
  })

  it('dismiss clears the spotlight and closes the carousel (I1)', () => {
    reset()
    useSelectionStore.getState().enterSpotlight('b')
    useSelectionStore.getState().dismiss()
    expect(useSelectionStore.getState().spotlightVenueId).toBeNull()
    expect(useSelectionStore.getState().mode).toBe('closed')
  })

  it('toggleOpen (close branch) clears the spotlight (I1)', () => {
    reset()
    useSelectionStore.getState().enterSpotlight('b') // opens browse
    expect(useSelectionStore.getState().mode).toBe('browse')
    useSelectionStore.getState().toggleOpen() // close
    expect(useSelectionStore.getState().spotlightVenueId).toBeNull()
    expect(useSelectionStore.getState().mode).toBe('closed')
  })

  it('selectVenue with a different id clears the spotlight (I2 exit intent)', () => {
    reset()
    useSelectionStore.getState().enterSpotlight('a')
    useSelectionStore.getState().selectVenue('b', 'search')
    expect(useSelectionStore.getState().spotlightVenueId).toBeNull()
    expect(useSelectionStore.getState().activeVenueId).toBe('b')
  })

  it('selectVenue with the same id keeps the spotlight', () => {
    reset()
    useSelectionStore.getState().enterSpotlight('a')
    useSelectionStore.getState().selectVenue('a', 'marker')
    expect(useSelectionStore.getState().spotlightVenueId).toBe('a')
  })

  it('step is a no-op while spotlit (stale-order race guard)', () => {
    reset()
    const store = useSelectionStore.getState()
    store.setOrder(['a', 'b', 'c'])
    store.enterSpotlight('a')
    useSelectionStore.getState().step(1)
    expect(useSelectionStore.getState().activeVenueId).toBe('a')
    expect(useSelectionStore.getState().spotlightVenueId).toBe('a')
  })
})
