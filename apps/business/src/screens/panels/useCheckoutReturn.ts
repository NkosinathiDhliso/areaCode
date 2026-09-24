import { api } from '@area-code/shared/lib/api'
import { useEffect, useRef, useState } from 'react'

import {
  computeReturnState,
  hasBoostPurchaseLanded,
  hasPaidStateLanded,
  parseReturnCheckoutId,
  parseReturnStatus,
  POLL_INTERVAL_MS,
  POLL_MAX_MS,
  RETURN_CHECKOUT_ID_PARAM,
  RETURN_PARAMS,
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

  // Strip the return params on mount in all cases (R6.3) so refresh does not
  // replay. Every caller has already read what it needs during render.
  useEffect(() => {
    if (status === null) return
    const url = new URL(window.location.href)
    for (const param of RETURN_PARAMS) url.searchParams.delete(param)
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
// Only the field that identifies the purchase is typed here.
interface BoostPurchasesResponse {
  items: Array<{ yocoCheckoutId: string }>
  nextCursor: string | null
}

// Where the pending Yoco checkout id waits while the browser is away at the
// payment page. Yoco builds no params of its own onto the return URL: the
// success URL is the one our checkout request supplied, and it is supplied
// before Yoco has issued the checkout id, so the id cannot ride the redirect.
// The portal therefore hands it over itself, and the hook reads the return URL
// as its single source (below).
const PENDING_BOOST_CHECKOUT_KEY = 'areaCode.pendingBoostCheckoutId'

/**
 * Remember the checkout the owner is about to pay for, called by `BoostPanel`
 * immediately before it navigates to Yoco.
 *
 * Storage can be unavailable (Safari private mode). That is not masked: without
 * the id the return leg cannot confirm the specific purchase, so the banner
 * times out and names support instead of claiming a confirmation.
 */
export function rememberPendingBoostCheckout(checkoutId: string): void {
  try {
    window.sessionStorage.setItem(PENDING_BOOST_CHECKOUT_KEY, checkoutId)
  } catch {
    // Private mode / storage disabled. See above.
  }
}

/**
 * Move the remembered checkout id onto the return URL, once, on the success
 * leg. After this the URL is the only thing the hook reads, so there is exactly
 * one source of the awaited identity and the tests exercise the real one.
 */
function promotePendingBoostCheckoutId(search: string): string {
  if (parseReturnStatus(search) !== 'success') return search
  if (parseReturnCheckoutId(search) !== null) return search
  let pending: string | null = null
  try {
    pending = window.sessionStorage.getItem(PENDING_BOOST_CHECKOUT_KEY)
    window.sessionStorage.removeItem(PENDING_BOOST_CHECKOUT_KEY)
  } catch {
    return search
  }
  if (pending === null || pending.length === 0) return search
  const url = new URL(window.location.href)
  url.searchParams.set(RETURN_CHECKOUT_ID_PARAM, pending)
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  return url.search
}

// Boost checkout-return (R6, boost path; R15.11): a boost has no absolute "paid
// tier" to poll for, so the return leg waits for THE purchase the owner just
// paid for, identified by the `yocoCheckoutId` the return URL carries. That is
// the same id the purchases list and the Boost_Scoreboard are keyed on.
//
// The count baseline this replaced was taken at the first poll, so a webhook
// that landed before that poll was already inside the baseline: the list never
// appeared to grow and the owner sat on "still processing" for a payment that
// had succeeded. Identity has no such window.
export function useBoostCheckoutReturn(businessId: string | null): UseCheckoutReturnResult {
  // Read once, during the first render, before the core's effect strips the
  // return params.
  const [awaitedCheckoutId] = useState(() =>
    parseReturnCheckoutId(promotePendingBoostCheckoutId(window.location.search)),
  )

  return useCheckoutReturnCore<BoostPurchasesResponse>({
    poll: () => {
      if (!businessId) return Promise.reject(new Error('no businessId'))
      return api.get<BoostPurchasesResponse>(`/v1/business/${businessId}/boost-purchases`)
    },
    hasLanded: (data) => hasBoostPurchaseLanded(data.items, awaitedCheckoutId),
  })
}
