import { api } from '@area-code/shared/lib/api'
import { useEffect, useRef, useState } from 'react'

import {
  computeReturnState,
  hasPaidStateLanded,
  parseReturnStatus,
  POLL_INTERVAL_MS,
  POLL_MAX_MS,
  type ReturnProfile,
  type ReturnState,
} from './checkoutReturnState'

export interface UseCheckoutReturnResult {
  returnState: ReturnState
  // True while a success poll is in flight; disables purchase buttons (R6.4).
  isPolling: boolean
  // Clears the return banner (e.g. after the user reads a cancelled message).
  dismiss: () => void
}

interface CheckoutReturnCoreConfig<T> {
  // The read to poll on a `success` return.
  poll: () => Promise<T>
  // Whether the awaited post-checkout state has landed in the polled data.
  hasLanded: (data: T, nowMs: number) => boolean
  // Called with each freshly polled result so the caller can refresh its UI.
  onData?: (data: T) => void
}

// Generalized checkout-return core (R6, design Flow 4): reads the status param,
// strips it from the URL so a refresh does not replay it, and on `success`
// polls the caller-supplied read every 2s for up to 60s until `hasLanded`
// reports the new state is visible. Reused by the plans and boost panels so the
// poll loop lives in exactly one place (dry-reuse-no-duplication).
export function useCheckoutReturnCore<T>({
  poll,
  hasLanded,
  onData,
}: CheckoutReturnCoreConfig<T>): UseCheckoutReturnResult {
  // Read the return status once at mount.
  const [status] = useState(() => parseReturnStatus(window.location.search))
  const [elapsedMs, setElapsedMs] = useState(0)
  const [landed, setLanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Keep the latest callbacks in refs so the poll effect need not depend on
  // them (they are re-created on every render by the wrapper hooks).
  const pollRef = useRef(poll)
  const hasLandedRef = useRef(hasLanded)
  const onDataRef = useRef(onData)
  useEffect(() => {
    pollRef.current = poll
    hasLandedRef.current = hasLanded
    onDataRef.current = onData
  })

  // Strip the param on mount in all cases (R6.3) so refresh does not replay.
  useEffect(() => {
    if (status === null) return
    const url = new URL(window.location.href)
    url.searchParams.delete('status')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [status])

  // Success poll loop.
  useEffect(() => {
    if (status !== 'success') return
    let cancelled = false
    const start = Date.now()

    async function runPoll(timer: ReturnType<typeof setInterval>) {
      try {
        const next = await pollRef.current()
        if (cancelled) return
        onDataRef.current?.(next)
        if (hasLandedRef.current(next, Date.now())) {
          setLanded(true)
          clearInterval(timer)
        }
      } catch {
        // Poll failures are non-fatal: keep polling until the window closes,
        // then the timeout message names support (R6.2).
      }
    }

    const timer = setInterval(() => {
      if (cancelled) return
      const elapsed = Date.now() - start
      setElapsedMs(elapsed)
      if (elapsed >= POLL_MAX_MS) {
        clearInterval(timer)
        return
      }
      void runPoll(timer)
    }, POLL_INTERVAL_MS)

    // Kick an immediate first poll so a fast activation confirms quickly.
    void runPoll(timer)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status])

  const returnState = dismissed ? 'idle' : computeReturnState({ status, elapsedMs, landed })
  const isPolling = returnState === 'activating'

  return { returnState, isPolling, dismiss: () => setDismissed(true) }
}

interface UseCheckoutReturnOptions<P extends ReturnProfile> {
  // Called with each freshly polled profile so the panel can refresh its
  // billing banner as activation lands.
  onProfile: (profile: P) => void
}

// Plans checkout-return (R6, plans path): polls GET /v1/business/me until the
// stored paid tier and a future paidUntil land. Thin wrapper over the core so
// the poll loop is not duplicated.
export function useCheckoutReturn<P extends ReturnProfile>({
  onProfile,
}: UseCheckoutReturnOptions<P>): UseCheckoutReturnResult {
  return useCheckoutReturnCore<P>({
    poll: () => api.get<P>('/v1/business/me'),
    hasLanded: (profile, nowMs) => hasPaidStateLanded(profile, nowMs),
    onData: onProfile,
  })
}

// A boost purchase row, as returned by GET /v1/business/{id}/boost-purchases.
// Only the fields needed to detect a new row are typed here.
interface BoostPurchaseRow {
  paidAt: string
  yocoCheckoutId: string
}

interface BoostPurchasesResponse {
  items: BoostPurchaseRow[]
  nextCursor: string | null
}

// Stable identity for a boost purchase row (matches the BoostPurchasesPanel key).
function boostRowKey(row: BoostPurchaseRow): string {
  return `${row.paidAt}#${row.yocoCheckoutId}`
}

// Boost checkout-return (R6, boost path): a boost has no absolute "paid tier"
// to poll for, so activation is confirmed when a NEW boost purchase row appears
// in the boost purchases list. The first poll captures a baseline (count and
// newest row) taken at mount; the boost is landed once the list grows or a
// newer row appears. Thin wrapper over the core - the poll loop is shared.
export function useBoostCheckoutReturn(businessId: string | null): UseCheckoutReturnResult {
  const baselineRef = useRef<{ count: number; newestKey: string | null } | null>(null)

  return useCheckoutReturnCore<BoostPurchasesResponse>({
    poll: () => {
      if (!businessId) return Promise.reject(new Error('no businessId'))
      return api.get<BoostPurchasesResponse>(`/v1/business/${businessId}/boost-purchases`)
    },
    hasLanded: (data) => {
      const count = data.items.length
      const newestKey = data.items[0] ? boostRowKey(data.items[0]) : null
      if (baselineRef.current === null) {
        // First poll establishes the baseline captured at mount; not landed yet.
        baselineRef.current = { count, newestKey }
        return false
      }
      const base = baselineRef.current
      return count > base.count || (newestKey !== null && newestKey !== base.newestKey)
    },
  })
}
