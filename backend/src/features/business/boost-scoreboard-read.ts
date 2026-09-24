// The read behind `GET /v1/business/boosts/:boostId/scoreboard`.
//
// Feature: proof-of-demand (R7.1, R7.2)
//
// `computeBoostScoreboard` owns the arithmetic and the panel owns the words.
// What this owns is the three things only a caller can know: which purchase the
// owner is asking about, which check-ins the two windows need, and whether the
// answer is still moving or is already history.
//
// The history rule (R7.2) is the reason this file exists rather than a plain
// compute-on-read. While the Boost_Window is open the numbers can still change,
// so every read computes live. Once it has closed they cannot, so the first read
// after closing stores the result and every later read returns that stored copy
// verbatim. A closed window is never recomputed: check-in rows can disappear
// later (POPIA erasure, retention), and recomputing would quietly rewrite what
// an owner was shown about a window they paid for.

import type { BoostScoreboardView } from '@area-code/shared/types'
import { z } from 'zod'

import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet } from '../../shared/kv/dynamodb-kv.js'
import type { ReceiptWindow } from '../reports/receipt.js'

import { boostScoreboardBaselineWindow, computeBoostScoreboard, type BoostScoreboard } from './boost-scoreboard.js'
import * as repo from './repository.js'
import { boostWindowEnd, type BoostDuration } from './types.js'

/**
 * Where a closed window's scoreboard is stored: the app-data KV, keyed on the
 * BoosterPurchase row's own key, so the cache entry and the purchase it
 * describes are addressed by the same identity and no second id has to be kept
 * in sync. No TTL: this is the owner's record of a window they paid for.
 */
export function boostScoreboardCacheKey(boostPk: string, boostSk: string): string {
  return `boost:score:${boostPk}:${boostSk}`
}

const countSchema = z.number().int().nonnegative()
const periodSchema = z.object({
  windowStartUtc: z.string().min(1),
  windowEndUtc: z.string().min(1),
  checkIns: countSchema,
  visitors: countSchema,
  foundYou: countSchema,
  walkIns: countSchema,
})

/** Deltas are signed: a quieter window than last week is a real answer. */
const deltaSchema = z.object({
  checkIns: z.number().int(),
  visitors: z.number().int(),
  foundYou: z.number().int(),
  walkIns: z.number().int(),
})

/**
 * The stored shape. Exactly what `computeBoostScoreboard` returned, so a cached
 * scoreboard and a live one are the same value read two ways. Validated on read
 * rather than trusted: an unreadable cache row is a bug that must surface, and
 * recomputing it would present fresh arithmetic as stable history.
 */
const cachedScoreboardSchema = z.object({
  window: periodSchema,
  baseline: periodSchema,
  comparable: z.boolean(),
  delta: deltaSchema.nullable(),
})

/**
 * The Boost_Window for one purchase: `paidAt` to `boostWindowEnd(paidAt,
 * duration)`. The stored purchase is the only source for both instants, so the
 * scoreboard covers the window the owner was actually sold.
 */
function windowForPurchase(paidAt: string, duration: BoostDuration): ReceiptWindow {
  return { windowStartUtc: paidAt, windowEndUtc: boostWindowEnd(paidAt, duration) }
}

function view(
  boostId: string,
  nodeId: string,
  windowClosed: boolean,
  scoreboard: BoostScoreboard,
): BoostScoreboardView {
  return { boostId, nodeId, windowClosed, ...scoreboard }
}

/**
 * The scoreboard for one boost purchase the caller's business owns.
 *
 * @param businessId The caller's business, from the JWT. Never from the client.
 * @param boostId The purchase's `yocoCheckoutId`, which the owner's purchase
 *   list already carries, resolved to the audit row through the existing
 *   Idempotency_Marker.
 *
 * @throws 404 when no such purchase exists for this business. A purchase owned
 *   by another business is reported identically to an unknown one, so the
 *   endpoint cannot be used to discover which checkout ids are real.
 */
export async function getBoostScoreboard(
  businessId: string,
  boostId: string,
  nowIso: string = new Date().toISOString(),
): Promise<BoostScoreboardView> {
  const marker = await repo.getBoosterCheckoutMarker(boostId)
  if (!marker || marker.businessId !== businessId) {
    throw AppError.notFound('No boost purchase on record for that id.')
  }

  const purchase = await repo.getBoosterPurchaseByKey(marker.boostPk, marker.boostSk)
  if (!purchase) {
    throw AppError.notFound('No boost purchase on record for that id.')
  }

  const boostWindow = windowForPurchase(purchase.paidAt, purchase.duration)
  const windowClosed = new Date(boostWindow.windowEndUtc).getTime() <= new Date(nowIso).getTime()
  const cacheKey = boostScoreboardCacheKey(marker.boostPk, marker.boostSk)

  if (windowClosed) {
    const cached = await kvGet(cacheKey)
    if (cached !== null) {
      const parsed = cachedScoreboardSchema.safeParse(JSON.parse(cached))
      if (!parsed.success) {
        // Loud, not papered over: recomputing would hand the owner a new number
        // wearing the label of the one they were shown.
        console.error(
          `[business] getBoostScoreboard: unreadable cached scoreboard at ${cacheKey}: ${parsed.error.message}`,
        )
        throw AppError.internal('That boost scoreboard could not be read.')
      }
      return view(boostId, purchase.nodeId, true, parsed.data)
    }
  }

  // One read covering both windows: from the baseline start through the boost
  // window end. `computeBoostScoreboard` scopes each window itself and ignores
  // the gap between them.
  const checkIns = await repo.getNodeCheckInsInRange(purchase.nodeId, {
    windowStartUtc: boostScoreboardBaselineWindow(boostWindow).windowStartUtc,
    windowEndUtc: boostWindow.windowEndUtc,
  })
  const scoreboard = computeBoostScoreboard(checkIns, boostWindow)

  // Only ever written on a cache miss, so a stored scoreboard is never replaced
  // by a recomputation. Two concurrent first reads would store the same value:
  // the window is closed, so the rows behind it no longer change.
  if (windowClosed) {
    await kvSet(cacheKey, JSON.stringify(scoreboard))
  }

  return view(boostId, purchase.nodeId, windowClosed, scoreboard)
}
