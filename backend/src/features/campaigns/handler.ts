import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { requireBusinessPermission, getBusinessRole } from '../../shared/middleware/business-role.js'
import { validate } from '../../shared/middleware/validation.js'
import { findBusinessById } from '../business/repository.js'
import { getEffectiveTier } from '../business/service.js'

import { putOptOut, removeOptOut, getOptOuts } from './repository.js'
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  estimateRecipients,
  sendCampaign,
  cancelCampaign,
} from './service.js'
import { assertCanSendCampaigns } from './tier-gating.js'
import {
  createCampaignBodySchema,
  sendCampaignBodySchema,
  campaignListQuerySchema,
  campaignIdParamsSchema,
  campaignOptOutBodySchema,
  unsubscribeQuerySchema,
} from './types.js'
import type {
  CampaignListQuery,
  CampaignIdParams,
  SendCampaignBody,
  CampaignOptOutBody,
  UnsubscribeQuery,
} from './types.js'
import { verifyUnsubscribeToken } from './unsubscribe.js'

// ============================================================================
// Win-Back Campaigns — Campaign API Routes (task 8.2)
// ----------------------------------------------------------------------------
// Fastify routes under `/v1/business/me/campaigns`, mirroring the reports
// feature's handler shape. Every route is protected by:
//   requireAuth('business','staff')          — owner (business pool) or manager (staff pool)
//   requireBusinessPermission('manage_campaigns') — only owner/manager hold it (R9.5)
//   validate({ body|query|params })           — Zod validation of the request
//
// businessId resolution: for an owner authenticated via the business pool,
// `auth.userId` IS the businessId. For a manager authenticated via the staff
// pool, `auth.userId` is the staffId — `requireBusinessPermission` resolves the
// real businessId and exposes it via `getBusinessRole(request).businessId`. We
// therefore read the businessId from the resolved business-role payload so both
// owners and managers operate on the correct business.
//
// Tier gating (Requirements 9.1, 9.2 / Property 13): the SEND route is gated —
// starter/payg → 402 `upgrade_required`; growth/pro → permitted (then subject
// to the service's monthly send-quota guard). Create/list/detail/estimate/
// cancel are intentionally NOT gated so the starter/payg teaser UI can still
// render campaign history and previews (design intent, Requirement 13.4).
//
// Error mapping: the service throws AppError subclasses (CampaignNotFoundError
// 404, NodeNotOwnedError/RewardNotOwnedError 403, CampaignAlreadySentError 409
// `already_sent`, CampaignQuotaExceededError 409 `quota_exceeded`+`remaining`,
// CampaignNotSendableError/CampaignNotCancellableError 409). The global app.ts
// error handler serializes every AppError (including `remaining`), so routes
// let them propagate — no re-mapping here.
//
// Constraints: C1 (no SMS/phone — channels enum is push/email only, enforced in
// types.ts) and C2 (serverless — send-now async-invokes the dispatcher Lambda).
// ============================================================================

const CAMPAIGN_PERMISSION = 'manage_campaigns'

export async function campaignRoutes(app: FastifyInstance) {
  // POST /v1/business/me/campaigns — create a draft campaign (Requirement 1.1)
  app.post(
    '/v1/business/me/campaigns',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission(CAMPAIGN_PERMISSION),
        validate({ body: createCampaignBodySchema }),
      ],
    },
    async (request, reply) => {
      const { businessId } = getBusinessRole(request)
      const body = request.body as z.infer<typeof createCampaignBodySchema>
      const campaign = await createCampaign(businessId, body)
      return reply.status(201).send(campaign)
    },
  )

  // GET /v1/business/me/campaigns — paginated list, newest first (Requirement 11.3)
  app.get(
    '/v1/business/me/campaigns',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission(CAMPAIGN_PERMISSION),
        validate({ query: campaignListQuerySchema }),
      ],
    },
    async (request) => {
      const { businessId } = getBusinessRole(request)
      const query = request.query as CampaignListQuery
      return listCampaigns(businessId, { cursor: query.cursor, limit: query.limit })
    },
  )

  // GET /v1/business/me/campaigns/:campaignId — detail + analytics (Requirement 11.3)
  app.get(
    '/v1/business/me/campaigns/:campaignId',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission(CAMPAIGN_PERMISSION),
        validate({ params: campaignIdParamsSchema }),
      ],
    },
    async (request) => {
      const { businessId } = getBusinessRole(request)
      const params = request.params as CampaignIdParams
      return getCampaign(businessId, params.campaignId)
    },
  )

  // POST /v1/business/me/campaigns/:campaignId/estimate — post-filter recipient
  // estimate (Requirements 13.2, 13.5). Not tier-gated so the teaser can preview.
  app.post(
    '/v1/business/me/campaigns/:campaignId/estimate',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission(CAMPAIGN_PERMISSION),
        validate({ params: campaignIdParamsSchema }),
      ],
    },
    async (request) => {
      const { businessId } = getBusinessRole(request)
      const params = request.params as CampaignIdParams
      return estimateRecipients(businessId, params.campaignId)
    },
  )

  // POST /v1/business/me/campaigns/:campaignId/send — send now or schedule
  // (Requirement 8.2). Tier-gated: starter/payg → 402 upgrade_required (9.2).
  app.post(
    '/v1/business/me/campaigns/:campaignId/send',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission(CAMPAIGN_PERMISSION),
        validate({ params: campaignIdParamsSchema, body: sendCampaignBodySchema }),
      ],
    },
    async (request) => {
      const { businessId } = getBusinessRole(request)
      const params = request.params as CampaignIdParams
      const body = request.body as SendCampaignBody

      // Tier gate FIRST — resolve the effective tier (honouring trial expiry,
      // matching the service's quota guard) and reject starter/payg with a 402
      // before any send work happens (Requirements 9.1, 9.2 / Property 13).
      const business = await findBusinessById(businessId)
      const tier = getEffectiveTier((business ?? {}) as { tier?: string; trialEndsAt?: string | null })
      assertCanSendCampaigns(tier)

      return sendCampaign(businessId, params.campaignId, body.scheduledAt)
    },
  )

  // POST /v1/business/me/campaigns/:campaignId/cancel — cancel draft/scheduled
  // (Requirement 8.4).
  app.post(
    '/v1/business/me/campaigns/:campaignId/cancel',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission(CAMPAIGN_PERMISSION),
        validate({ params: campaignIdParamsSchema }),
      ],
    },
    async (request) => {
      const { businessId } = getBusinessRole(request)
      const params = request.params as CampaignIdParams
      return cancelCampaign(businessId, params.campaignId)
    },
  )
}

// ============================================================================
// Win-Back Campaigns — Consumer Opt-Out & One-Click Unsubscribe (task 8.3)
// ----------------------------------------------------------------------------
// Two consumer-facing routes that let a consumer stop receiving campaigns,
// satisfying Requirement 12. Both write the same `COPTOUT#` rows via
// `putOptOut` in `repository.ts`, which the dispatcher's eligibility filter
// honours on the next dispatch (Requirement 12.3).
//
//   POST /v1/users/me/campaign-optout   (consumer auth)
//     Body `{ businessId? }`. Omitting `businessId` is a GLOBAL opt-out
//     (`putOptOut(userId, 'ALL')`); providing one opts out of that single
//     business (Requirements 12.1, 12.3).
//
//   GET  /v1/campaigns/unsubscribe?token=...   (NO auth)
//     The one-click link embedded in every campaign email. The signed token
//     (see `unsubscribe.ts`) carries the recipient `userId` and the sending
//     `businessId`; it is HMAC-verified, then a per-business opt-out is written.
//     This MUST work without a login and without any phone/SMS re-auth
//     (Requirement 12.4 / Constraint C1) — it is clicked straight from an inbox
//     in a browser, so it responds with a small confirmation HTML page.
//
// These routes are deliberately registered SEPARATELY from the business-
// permission-gated `campaignRoutes`: one is consumer auth, the other is
// unauthenticated, so neither carries the `requireBusinessPermission`
// preHandlers. No phone number is read, written, or required anywhere here.
// ============================================================================

/** Minimal styled HTML confirmation page returned by the one-click route. */
function unsubscribePage(title: string, message: string): string {
  // Self-contained, inline-styled page — no external assets, safe to render
  // straight from an email client's in-app browser. The title/message strings
  // are static (no user-controlled interpolation) so there is no injection risk.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0f1115; color: #e8eaed; margin: 0; display: flex;
         min-height: 100vh; align-items: center; justify-content: center; }
  .card { background: #1a1d24; border-radius: 16px; padding: 40px 32px; max-width: 420px;
          text-align: center; box-shadow: 0 8px 40px rgba(0,0,0,0.4); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.5; color: #aab1bd; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`
}

export async function campaignConsumerRoutes(app: FastifyInstance) {
  // POST /v1/users/me/campaign-optout — consumer opts out of one business or
  // all businesses (Requirements 12.1, 12.3).
  app.post(
    '/v1/users/me/campaign-optout',
    {
      preHandler: [requireAuth('consumer'), validate({ body: campaignOptOutBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as CampaignOptOutBody

      const scope = body.businessId ?? 'ALL'

      // optOut:false opts the consumer back in (removes the row); the default
      // optOut:true writes the opt-out. Both honour the resolved scope.
      if (body.optOut === false) {
        await removeOptOut(auth.userId, scope)
        return { optedOut: false, scope: body.businessId ?? ('all' as const) }
      }

      await putOptOut(auth.userId, scope)
      return { optedOut: true, scope: body.businessId ?? ('all' as const) }
    },
  )

  // GET /v1/users/me/campaign-optout — read the consumer's global opt-out
  // status so the in-app preference toggle can reflect the persisted state.
  app.get(
    '/v1/users/me/campaign-optout',
    {
      preHandler: [requireAuth('consumer')],
    },
    async (request) => {
      const auth = getAuth(request)
      const state = await getOptOuts(auth.userId)
      return { optedOut: state.global, businessIds: state.businessIds }
    },
  )

  // GET /v1/campaigns/unsubscribe?token=... — one-click email unsubscribe, no
  // login, no phone/SMS re-auth (Requirement 12.4 / Constraint C1).
  app.get(
    '/v1/campaigns/unsubscribe',
    {
      preHandler: [validate({ query: unsubscribeQuerySchema })],
    },
    async (request, reply) => {
      const { token } = request.query as UnsubscribeQuery

      const verified = verifyUnsubscribeToken(token)
      if (!verified) {
        // Malformed or tampered token — write nothing, show a friendly notice.
        return reply
          .status(400)
          .type('text/html')
          .send(
            unsubscribePage(
              'Unsubscribe link invalid',
              'This unsubscribe link is invalid or has expired. You can manage your preferences from inside the app at any time.',
            ),
          )
      }

      // Valid token → per-business opt-out from the email's sending business.
      await putOptOut(verified.userId, verified.businessId)

      return reply
        .status(200)
        .type('text/html')
        .send(
          unsubscribePage(
            "You're unsubscribed",
            'You will no longer receive win-back campaign emails from this business. You can opt back in anytime from your in-app preferences.',
          ),
        )
    },
  )
}
