import { AppError } from '../../shared/errors/AppError.js'
import { findBusinessById } from '../business/repository.js'
import { getEffectiveTier } from '../business/service.js'
import { notifyNewRewardConsumers } from '../notifications/service.js'

import { validateWindow, classifyLifecycle, isVisibleInFeed } from './lifecycle.js'
import { pulseStateFromScore, rankGetsByVibe } from './ranking.js'
import * as repo from './repository.js'
import { countLocksForReward } from './threshold-lock.js'
import { DEV_MODE } from '../../shared/config/env.js'
import { isConditionalCheckFailedError } from '../../shared/db/dynamodb.js'

const DEV_REWARDS = [
  {
    id: 'rew-1',
    title: 'Free Coffee',
    type: 'freebie',
    totalSlots: 50,
    claimedCount: 12,
    nodeId: 'dev-1',
    nodeName: 'Father Coffee',
    nodeSlug: 'father-coffee',
    distance: 150,
    pulseScore: 8,
    liveCount: 2,
    expiresAt: null,
  },
  {
    id: 'rew-2',
    title: '20% Off Cocktails',
    type: 'discount',
    totalSlots: 30,
    claimedCount: 8,
    nodeId: 'dev-3',
    nodeName: "Kitchener's Bar",
    nodeSlug: 'kitcheners-bar',
    distance: 800,
    pulseScore: 72,
    liveCount: 23,
    expiresAt: null,
  },
  {
    id: 'rew-3',
    title: 'Free Starter',
    type: 'freebie',
    totalSlots: 20,
    claimedCount: 5,
    nodeId: 'dev-7',
    nodeName: "Nando's Rosebank",
    nodeSlug: 'nandos-rosebank',
    distance: 1200,
    pulseScore: 18,
    liveCount: 4,
    expiresAt: null,
  },
  {
    id: 'rew-4',
    title: 'Buy 1 Get 1 Free',
    type: 'bogo',
    totalSlots: 100,
    claimedCount: 45,
    nodeId: 'dev-9',
    nodeName: 'The Grillhouse',
    nodeSlug: 'the-grillhouse',
    distance: 600,
    pulseScore: 55,
    liveCount: 15,
    expiresAt: null,
  },
  {
    id: 'rew-5',
    title: 'Free Day Pass',
    type: 'freebie',
    totalSlots: 10,
    claimedCount: 3,
    nodeId: 'dev-10',
    nodeName: 'Virgin Active Sandton',
    nodeSlug: 'virgin-active-sandton',
    distance: 2000,
    pulseScore: 3,
    liveCount: 0,
    expiresAt: null,
  },
  // Event & Offer Gets dev fixtures (R7.3). DEV_MODE returns DEV_REWARDS
  // directly (bypassing the lifecycle filter), so these carry a window that is
  // live right now — `startsAt` an hour ago, `endsAt` six hours out — to model
  // a live Event_Get and a live Offer_Get for the dev surfaces.
  {
    id: 'rew-6',
    title: 'Live Amapiano Set Tonight',
    type: 'event',
    totalSlots: 200,
    claimedCount: 37,
    nodeId: 'dev-3',
    nodeName: "Kitchener's Bar",
    nodeSlug: 'kitcheners-bar',
    distance: 800,
    pulseScore: 72,
    liveCount: 23,
    expiresAt: null,
    getCategory: 'event',
    startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    claimRequiresCheckIn: true,
  },
  {
    id: 'rew-7',
    title: '2-for-1 Cocktails (6-9pm)',
    type: 'offer',
    totalSlots: 80,
    claimedCount: 19,
    nodeId: 'dev-1',
    nodeName: 'Father Coffee',
    nodeSlug: 'father-coffee',
    distance: 150,
    pulseScore: 8,
    liveCount: 2,
    expiresAt: null,
    getCategory: 'offer',
    startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    claimRequiresCheckIn: true,
  },
  // Repeat_Policy dev fixture (R7.3). One loyalty `nth_checkin` get with
  // `repeatPolicy: 'per_visit'` so the dev surfaces exercise the new policy:
  // a regular past the 5th visit can earn it again each visit, gated by the
  // 4-hour Repeat_Window. All synthetic data stays behind the DEV_MODE guard.
  {
    id: 'rew-8',
    title: 'Free Coffee Every 5th Visit',
    type: 'nth_checkin',
    totalSlots: 100,
    claimedCount: 22,
    nodeId: 'dev-1',
    nodeName: 'Father Coffee',
    nodeSlug: 'father-coffee',
    distance: 150,
    pulseScore: 8,
    liveCount: 2,
    expiresAt: null,
    getCategory: 'loyalty',
    triggerValue: 5,
    repeatPolicy: 'per_visit',
  },
]

const TIER_REWARD_LIMITS: Record<string, number | null> = {
  free: 3,
  starter: 3,
  growth: 10,
  pro: null,
  payg: 3,
}

export async function createReward(
  businessId: string,
  data: {
    nodeId: string
    // `type` is optional now that event/offer gets may omit it (R1.4). The
    // authoritative resolution (default `type = getCategory`, window
    // validation, persistence threading) lands in task 4.1; this signature is
    // widened here so the extended create schema typechecks.
    type?: string | undefined
    title: string
    description?: string | undefined
    triggerValue?: number | undefined
    totalSlots?: number | undefined
    expiresAt?: string | undefined
    isFirstGet?: boolean | undefined
    getCategory?: 'loyalty' | 'event' | 'offer' | undefined
    startsAt?: string | undefined
    endsAt?: string | undefined
    claimRequiresCheckIn?: boolean | undefined
    // Repeat_Policy (R1.1, R1.3). Absent → `once` (the read model default).
    // `per_visit` is accepted only for loyalty `nth_checkin` gets; the
    // authoritative check lives below (the Zod refinement covers the create
    // body, this is the service-layer guard against any other caller path).
    repeatPolicy?: 'once' | 'per_visit' | undefined
  },
) {
  // Verify the node belongs to this business
  const node = await repo.getNodeById(data.nodeId)
  if (!node || node.businessId !== businessId) {
    throw AppError.forbidden('Node does not belong to your business')
  }

  const business = await findBusinessById(businessId)
  const effectiveTier = getEffectiveTier((business as any) ?? { tier: 'free' })
  const count = await repo.countActiveRewardsForBusiness(businessId)
  const limit = TIER_REWARD_LIMITS[effectiveTier] ?? TIER_REWARD_LIMITS['free']
  if (limit !== undefined && limit !== null && count >= limit) {
    throw AppError.forbidden('Active reward limit reached for your tier')
  }

  // Enforce one First-Get per venue (Churn-defences spec, Req 6.1).
  // Independent of get category (R2.6): an event/offer get may also be flagged
  // First-Get, subject to the same one-per-node constraint.
  if (data.isFirstGet) {
    const existing = await repo.getActiveRewardsByNodeId(data.nodeId)
    if (existing.some((r) => (r as { isFirstGet?: boolean }).isFirstGet)) {
      throw AppError.badRequest('first_get_already_set')
    }
  }

  // Resolve the get category (R1.1). Absent → `loyalty`, preserving every
  // existing behaviour.
  const getCategory = data.getCategory ?? 'loyalty'
  const isEventOrOffer = getCategory === 'event' || getCategory === 'offer'

  // For event/offer gets, validate the Active_Window against the current clock
  // (R1.3, R1.6, R2.4). The pure `validateWindow` returns a mapped rejection
  // code; surface it as a 400 via the existing AppError machinery.
  let claimRequiresCheckIn: boolean | undefined
  if (isEventOrOffer) {
    const windowCheck = validateWindow(data.startsAt ?? '', data.endsAt ?? '', Date.now())
    if (!windowCheck.ok) {
      throw AppError.badRequest(windowCheck.code)
    }
    // Default claim-on-check-in to `true` for event/offer gets (R1.5).
    claimRequiresCheckIn = data.claimRequiresCheckIn ?? true
  }

  // Resolve the on-disk `type` once so both the Repeat_Policy check and
  // persistence agree (R1.4: loyalty gets always supply `type`).
  const resolvedType = data.type ?? (isEventOrOffer ? getCategory : 'nth_checkin')

  // Repeat_Policy authoritative validation (R1.3). `per_visit` is valid only on
  // loyalty `nth_checkin` gets; anything else is rejected 400 `repeat_not_supported`
  // and never persisted. Mirrors the Zod refinement, kept here as the service-layer
  // source of truth for any non-HTTP caller.
  if (data.repeatPolicy === 'per_visit' && (getCategory !== 'loyalty' || resolvedType !== 'nth_checkin')) {
    throw AppError.badRequest('repeat_not_supported')
  }

  const createData: Parameters<typeof repo.createReward>[0] = {
    nodeId: data.nodeId,
    // Keep `type` non-null on disk. When omitted for an event/offer get it
    // falls back to the category (R1.4); loyalty gets always supply `type`.
    type: resolvedType,
    title: data.title,
  }
  if (data.description !== undefined) createData.description = data.description
  if (data.triggerValue !== undefined) createData.triggerValue = data.triggerValue
  if (data.totalSlots !== undefined) createData.totalSlots = data.totalSlots
  if (data.expiresAt !== undefined) createData.expiresAt = data.expiresAt
  if (data.isFirstGet !== undefined) (createData as { isFirstGet?: boolean }).isFirstGet = data.isFirstGet

  // Persist Repeat_Policy when supplied (R1.1). Absent stays absent on disk and
  // reads back as `once`; no backfill (R7.1).
  if (data.repeatPolicy !== undefined) createData.repeatPolicy = data.repeatPolicy

  // Thread the event/offer attributes through to persistence (R2.5). Loyalty
  // gets leave these undefined so existing rows are untouched.
  if (isEventOrOffer) {
    createData.getCategory = getCategory
    if (data.startsAt !== undefined) createData.startsAt = data.startsAt
    if (data.endsAt !== undefined) createData.endsAt = data.endsAt
    createData.claimRequiresCheckIn = claimRequiresCheckIn
  }

  const reward = await repo.createReward(createData)

  // R8.1: structured info-level audit log for event/offer get creation.
  if (isEventOrOffer) {
    console.info(
      JSON.stringify({
        feature: 'rewards',
        operation: 'createReward',
        getCategory,
        businessId,
        nodeId: data.nodeId,
        startsAt: data.startsAt ?? null,
        endsAt: data.endsAt ?? null,
        claimRequiresCheckIn,
      }),
    )
  }

  // Fire-and-forget: notify consumers who checked in at this node recently
  // This runs asynchronously so it doesn't slow down the reward creation response
  const nodeName = node.name ?? ''
  notifyNewRewardConsumers(data.nodeId, nodeName, reward.rewardId, data.title).catch(() => {
    // Silently ignore — fire-and-forget
  })

  return reward
}

export async function updateReward(
  rewardId: string,
  businessId: string,
  data: {
    title?: string | undefined
    description?: string | undefined
    isActive?: boolean | undefined
    expiresAt?: string | null | undefined
    isFirstGet?: boolean | undefined
    // Loyalty check-in threshold (Churn-defences R1.7). Existing Threshold_Lock
    // rows are left untouched by this write (R1.2); the grandfathering logic in
    // threshold-lock.ts gives locked users the better of the two values.
    triggerValue?: number | undefined
    // Event/Offer get attributes (R1.3, R1.6). An update may (re)assert the
    // category and/or move the window; the resulting row must still hold a
    // valid Active_Window when it is an event/offer.
    getCategory?: 'loyalty' | 'event' | 'offer' | undefined
    startsAt?: string | undefined
    endsAt?: string | undefined
    claimRequiresCheckIn?: boolean | undefined
    // Repeat_Policy (R1.1, R1.3). `type` is immutable and not part of the update
    // body, so the authoritative loyalty + `nth_checkin` check runs against the
    // persisted row below.
    repeatPolicy?: 'once' | 'per_visit' | undefined
  },
) {
  const reward = await repo.getRewardById(rewardId)
  if (!reward) throw AppError.notFound('Reward not found')
  if (reward.node?.businessId !== businessId) {
    throw AppError.forbidden('You do not own this reward')
  }

  // Enforce uniqueness if promoting this reward to First-Get.
  if (data.isFirstGet === true && (reward as { isFirstGet?: boolean }).isFirstGet !== true) {
    const existing = await repo.getActiveRewardsByNodeId(reward.nodeId)
    if (
      existing.some((r) => {
        const id = (r as { rewardId?: string }).rewardId
        return (r as { isFirstGet?: boolean }).isFirstGet && id !== rewardId
      })
    ) {
      throw AppError.badRequest('first_get_already_set')
    }
  }

  // Determine the effective category/window the row will have AFTER this
  // update by merging the incoming fields over the persisted row. The read
  // mapper already defaults a missing `getCategory` to `loyalty` (R1.1).
  const persisted = reward as {
    getCategory?: 'loyalty' | 'event' | 'offer'
    startsAt?: string
    endsAt?: string
  }
  const effectiveCategory = data.getCategory ?? persisted.getCategory ?? 'loyalty'
  const isEventOrOffer = effectiveCategory === 'event' || effectiveCategory === 'offer'

  if (isEventOrOffer) {
    // Re-validate the Active_Window the row will end up with (R1.3, R1.6).
    // Never allow an update that leaves an event/offer without a valid window:
    // a missing bound parses to NaN and is rejected as `invalid_window` below.
    const effectiveStartsAt = data.startsAt ?? persisted.startsAt ?? ''
    const effectiveEndsAt = data.endsAt ?? persisted.endsAt ?? ''
    const windowCheck = validateWindow(effectiveStartsAt, effectiveEndsAt, Date.now())

    // The binding rules for an UPDATE are ordering (R1.3) and the 30-day max
    // (R1.6). We intentionally tolerate `starts_in_past`: an event being edited
    // may already be live (its `startsAt` is legitimately in the past), and
    // re-validating against `Date.now()` would otherwise wrongly block editing
    // a live event's title, end time, or check-in flag. So we enforce only
    // `invalid_window` and `window_too_long` here and accept `starts_in_past`.
    if (!windowCheck.ok && windowCheck.code !== 'starts_in_past') {
      throw AppError.badRequest(windowCheck.code)
    }
  }

  // Repeat_Policy authoritative validation against the persisted row (R1.3).
  // `type` is immutable, so `per_visit` is accepted only when the row is — or
  // becomes — a loyalty get AND its persisted `type` is `nth_checkin`.
  // Otherwise reject 400 `repeat_not_supported` and never persist.
  if (data.repeatPolicy === 'per_visit') {
    const persistedType = (reward as { type?: string }).type
    if (effectiveCategory !== 'loyalty' || persistedType !== 'nth_checkin') {
      throw AppError.badRequest('repeat_not_supported')
    }
  }

  const updateData: Parameters<typeof repo.updateReward>[1] = {}
  if (data.title !== undefined) updateData.title = data.title
  if (data.description !== undefined) updateData.description = data.description
  if (data.isActive !== undefined) updateData.isActive = data.isActive
  if (data.expiresAt === null) {
    updateData.expiresAt = null
  } else if (data.expiresAt !== undefined) {
    updateData.expiresAt = data.expiresAt
  }
  if (data.isFirstGet !== undefined) (updateData as { isFirstGet?: boolean }).isFirstGet = data.isFirstGet
  if (data.triggerValue !== undefined) (updateData as { triggerValue?: number }).triggerValue = data.triggerValue

  // Thread the event/offer attributes through to persistence so an update can
  // (re)assert the category and window. Undefined fields are dropped by the
  // repository, leaving loyalty rows untouched.
  if (data.getCategory !== undefined) updateData.getCategory = data.getCategory
  if (data.startsAt !== undefined) updateData.startsAt = data.startsAt
  if (data.endsAt !== undefined) updateData.endsAt = data.endsAt
  if (data.claimRequiresCheckIn !== undefined) updateData.claimRequiresCheckIn = data.claimRequiresCheckIn
  // Persist Repeat_Policy when supplied (R1.1); absent leaves the row untouched.
  if (data.repeatPolicy !== undefined) updateData.repeatPolicy = data.repeatPolicy

  return repo.updateReward(rewardId, updateData)
}

/**
 * Count consumers with in-flight grandfathered progress toward a reward, so
 * the business portal can warn an operator before they change the threshold
 * (Churn-defences R1.7: "N customers will keep their existing progress").
 * Ownership is enforced the same way as updateReward — the reward's node must
 * belong to the calling business, otherwise 403.
 */
export async function getRewardLockCount(rewardId: string, businessId: string): Promise<{ count: number }> {
  if (DEV_MODE) {
    return { count: 3 }
  }
  const reward = await repo.getRewardById(rewardId)
  if (!reward) throw AppError.notFound('Reward not found')
  if (reward.node?.businessId !== businessId) {
    throw AppError.forbidden('You do not own this reward')
  }
  const count = await countLocksForReward(rewardId)
  return { count }
}

export async function getRewardsNearMe(lat: number, lng: number, viewerId?: string) {
  if (DEV_MODE) {
    // Mirror the production path: taste-first ordering (taste → aliveness → tier
    // → has-live-gets → proximity) and a derived Pulse_State, so the dev surface
    // shows the same ranking behaviour as prod. Taste is neutral (0) in dev.
    const liveGetNodes = new Set(
      DEV_REWARDS.filter((r) => r.getCategory === 'event' || r.getCategory === 'offer').map((r) => r.nodeId),
    )
    return rankGetsByVibe(
      DEV_REWARDS.map((r) => ({
        ...r,
        tasteMatch: 0,
        aliveness: (r.pulseScore ?? 0) + (r.liveCount ?? 0),
        tierMultiplier: 1.0,
        hasLiveGets: liveGetNodes.has(r.nodeId),
        distanceMeters: r.distance,
      })),
    ).map((r) => ({ ...r, pulseState: pulseStateFromScore(r.pulseScore ?? 0) }))
  }

  const raw = await repo.getRewardsNearMe(lat, lng, viewerId)
  const nowMs = Date.now()
  return raw
    .filter((r) => {
      // Lifecycle filter (R3.2, R3.3, R3.4). Loyalty gets always pass through
      // using the existing proximity selection (R3.3); event/offer gets are
      // kept only while `live`; a missing window is treated as not-live. The
      // pure `isVisibleInFeed` helper in lifecycle.ts is the single source of
      // truth for this predicate (the repo defaults a missing `getCategory` to
      // `loyalty`, so legacy rows are unaffected — R1.1).
      return isVisibleInFeed(
        {
          getCategory: (r as { getCategory?: 'loyalty' | 'event' | 'offer' }).getCategory,
          startsAt: (r as { startsAt?: string | null }).startsAt,
          endsAt: (r as { endsAt?: string | null }).endsAt,
        },
        nowMs,
      )
    })
    .map((r) => {
      const getCategory = (r as { getCategory?: 'loyalty' | 'event' | 'offer' }).getCategory ?? 'loyalty'
      const startsAt = (r as { startsAt?: string | null }).startsAt ?? null
      const endsAt = (r as { endsAt?: string | null }).endsAt ?? null
      return {
        id: r.id,
        title: r.title,
        type: r.type,
        totalSlots: r.total_slots,
        claimedCount: r.claimed_count,
        nodeId: r.node_id,
        nodeName: r.node_name,
        nodeSlug: r.node_slug,
        distance: Math.round(r.distance),
        // Honest aliveness, surfaced so the consumer card can LEAD with
        // "who's here now" + vibe instead of distance (discovery-DNA +
        // honest-presence). `liveCount` is the honest current presence;
        // `pulseState` is derived from the same decaying pulse score the map
        // uses. The vibe-first ordering is already applied in the repository.
        liveCount: (r as { live_count?: number }).live_count ?? 0,
        pulseScore: (r as { pulse_score?: number }).pulse_score ?? 0,
        pulseState: pulseStateFromScore((r as { pulse_score?: number }).pulse_score ?? 0),
        // `expires_at` already comes back from the DynamoDB repo as an ISO string
        // (legacy Prisma returned a Date here). Calling `.toISOString()` on a string
        // throws a TypeError → 500 on the Gets page whenever a nearby reward has an
        // expiry. Pass the string through as-is.
        expiresAt: (r.expires_at as string | null) ?? null,
        // Surface the category/window/lifecycle so the response stays a
        // superset of today's shape (R7.2). Loyalty rows carry `lifecycle:
        // 'live'` since they have no window but always show when selected.
        getCategory,
        startsAt,
        endsAt,
        lifecycle:
          getCategory === 'loyalty' || !startsAt || !endsAt ? 'live' : classifyLifecycle(startsAt, endsAt, nowMs),
      }
    })
}

export async function getUnclaimedRewards(userId: string) {
  if (DEV_MODE) {
    return [
      {
        id: 'claim-1',
        rewardTitle: 'Free Coffee',
        redemptionCode: 'AC-COFFEE-1234',
        codeExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        nodeName: 'Father Coffee',
      },
      {
        id: 'claim-2',
        rewardTitle: '20% Off Cocktails',
        redemptionCode: 'AC-DRINK-5678',
        codeExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        nodeName: "Kitchener's Bar",
      },
    ]
  }
  return repo.getUnclaimedRewards(userId)
}

export async function redeemReward(code: string, staffId?: string) {
  if (DEV_MODE) {
    return { success: true, rewardTitle: 'Free Coffee', redeemedAt: new Date().toISOString() }
  }
  const redemption = await repo.findRedemptionByCode(code)
  if (!redemption) throw AppError.badRequest('invalid_code')
  if (redemption.redeemedAt) throw AppError.badRequest('already_redeemed')
  if (redemption.codeExpiresAt && redemption.codeExpiresAt < new Date().toISOString())
    throw AppError.badRequest('expired_code')

  // Fail closed: resolve the reward and its owning node BEFORE any redemption
  // write (R5.1). A code whose reward or node cannot be resolved is never
  // honoured — the old behaviour of skipping the ownership check when the
  // lookup failed is removed. A code for a deactivated reward is rejected as a
  // dead get (R5.2).
  const rewardId = redemption.rewardId ?? redemption.id
  const rewardDetail = await repo.getRewardById(rewardId)
  if (!rewardDetail || !rewardDetail.node?.businessId) {
    throw AppError.badRequest('invalid_code')
  }
  if (rewardDetail.isActive === false) {
    throw AppError.badRequest('reward_inactive')
  }

  // The staff-to-business ownership check always runs when a staffId is present
  // (never skipped now that the reward and node are resolved above).
  let staffName: string | undefined
  if (staffId) {
    const { getStaffById } = await import('../auth/dynamodb-repository.js')
    const staff = await getStaffById(staffId)
    // Fail closed: reject unknown staff, staff from another business, and
    // removed staff (isActive === false). A still-valid access token must not
    // let a removed member keep validating redemptions, since the Cognito
    // disable on removal only stops refresh/new logins.
    if (!staff || staff.isActive === false || staff.businessId !== rewardDetail.node.businessId) {
      throw AppError.forbidden('You cannot redeem rewards for this business')
    }
    staffName = staff.name
  }

  try {
    await repo.markRedeemed(redemption.id as string, staffId, staffName)
  } catch (err) {
    // A concurrent confirm already redeemed this code between our read above
    // and this write. The conditional write in `markRedemptionAsRedeemed`
    // fails closed, so surface the same error a sequential double-redeem gets.
    if (isConditionalCheckFailedError(err)) throw AppError.badRequest('already_redeemed')
    throw err
  }
  // Invalidate leaderboard cache so the new redemption shows up immediately.
  try {
    const { clearLeaderboardCache } = await import('../business/staff-leaderboard.js')
    clearLeaderboardCache()
  } catch {
    // Non-fatal: stale cache resolves itself in 5 minutes.
  }
  return {
    success: true,
    rewardTitle: redemption.reward?.title ?? '',
    redeemedAt: new Date().toISOString(),
  }
}

export async function getRecentRedemptions(businessId: string) {
  if (DEV_MODE) {
    return { items: [{ code: 'AC-COFFEE-1234', redeemedAt: new Date().toISOString() }] }
  }
  const items = await repo.getRecentRedemptions(businessId)
  return {
    items: items.map((r) => ({
      code: r.redemptionCode,
      // `redeemedAt` is already an ISO string from the DynamoDB repo; the legacy
      // `.toISOString()` call threw a TypeError (500) for the same reason as
      // getRewardsNearMe above.
      redeemedAt: (r.redeemedAt as string | undefined) ?? null,
    })),
  }
}

// ─── Staff Recent Redemptions ───────────────────────────────────────────────

export async function getStaffRecentRedemptions(staffId: string) {
  if (DEV_MODE) {
    return {
      items: [
        {
          code: 'AC-MOCK-1234',
          rewardTitle: 'Free Coffee',
          displayName: 'Thabo M.',
          redeemedAt: new Date(Date.now() - 600000).toISOString(),
        },
        {
          code: 'AC-MOCK-5678',
          rewardTitle: '20% Off Cocktails',
          displayName: 'Naledi K.',
          redeemedAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ],
    }
  }
  const rawItems = await repo.getStaffRecentRedemptions(staffId)
  const items = rawItems.map((r: Record<string, unknown>) => ({
    code: (r['redemptionCode'] ?? r['code'] ?? '') as string,
    rewardTitle: (r['rewardTitle'] ?? '') as string,
    displayName: (r['displayName'] ?? '') as string,
    redeemedAt: (r['redeemedAt'] ?? '') as string,
  }))
  return { items }
}
