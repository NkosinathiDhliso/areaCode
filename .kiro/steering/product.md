<!-- GENERATED FILE. DO NOT EDIT.
     Single source of truth: rules/*.md
     Regenerate with: pnpm sync:rules -->

# Product: what Area Code is

Area Code is a map-first social discovery app for South African cities
(Johannesburg, Cape Town, Durban). Consumers check in at venues, earn rewards,
and see live activity on a map. Businesses see live check-ins, publish rewards,
and get anonymized intelligence on their crowd. Live at areacode.co.za.

The product is trust in a live signal. The map pulls people toward places that
are alive and full of their kind of crowd, not toward whatever is closest. See
`discovery-dna-vibe-over-convenience.md` and `honest-presence.md` for the
binding rules behind that promise.

## Platform focus

- Consumer web + mobile: mobile-first, 375px baseline, real touch targets.
- Staff: mobile-first, simple validator UI.
- Business: responsive, works on phone and desktop.
- Admin: responsive, works on phone and desktop.

## Map membership (which venues appear)

The consumer map shows only paid-tier venues. A venue joins the map when its
owning business is on a paid tier (`starter`, `payg`, `growth`, `pro`) and the
node is active. Free-tier businesses and orphan/legacy nodes (no `businessId`)
are excluded. The rule lives in `backend/src/features/nodes/repository.ts`
`getNodesByCitySlug` and the broadcast path in `nodes/service.ts`.

Membership is a hard gate, separate from ranking. Business tier is also a minor
lever inside `vibeRank` that breaks ties among equally-alive, equally-taste-matched
venues (below taste and aliveness), but that lever is a different mechanism from
the membership gate. The membership gate keys off the stored tier plus `isActive`;
the single removal mechanism is storage demotion after the non-payment grace
window. This is a recorded decision: see `docs/decisions/map-membership.md`. Any
change to paid-only membership is a follow-up spec, not a silent edit.

## Gets (rewards) product rules

Gets are a free engagement layer, not a deals catalog. Belonging beats bargains:
a get is the cherry on top of vibe-first discovery, never the reason to open the
app. These are hard rules.

- **No standalone gets/deals browse surface.** The consumer app is four tabs
  (Map, Ranks, Feed, Profile). There is no "Gets Near You" tab, screen, or deals
  list, and we do not re-add one. Gets surface on the map (venue detail) and in
  the feed as a reward layer, discovered vibe-first, never a list to shop by
  discount size. A deals catalog inverts monetization (it rewards the biggest
  discounter, usually a non-paying venue) and breaks the discovery DNA.
- **Wallet lives in Profile.** Earned-but-unredeemed codes (`useUnclaimedRewards`
  - `RedemptionCodeCard`) render in `ProfileScreen` (web) and the profile tab
    (mobile). It is utility, a code to show staff, not a discovery surface.
- **Only proximity-gated reads.** The single consumer discovery read is
  `GET /v1/rewards/near-me` (plus the user's own
  `GET /v1/users/me/unclaimed-rewards`). No global events/offers feed, list, or
  search. Enforced by
  `backend/src/features/rewards/__tests__/no-global-events-feed.test.ts`.
- **Ranking mirrors the carousel.** `rankGetsByVibe`
  (`backend/src/features/rewards/ranking.ts`) orders by taste, aliveness,
  business tier, has-live-gets, distance, id: the same signal order as
  `vibeRank`. Tier participates (founder-approved) but sits below taste and
  aliveness, so a paid get must still be on-taste and alive to lead. Reach is the
  paid product; feed position is earned, never bought outright.

## Receipt: what Area Code claims it did

The owner-facing proof of demand is one Receipt per window, never a causal
claim. Decisions and thresholds: `docs/decisions/proof-of-demand.md`.

- **Found_You vs Walk_In, server-derived.** A check-in is Found_You only when
  the consumer opened that venue in Area Code first: a sourced Venue_Open
  (`share`, `push`, `search`, `map`) inside the Attribution_Window (6h) that
  also clears the Away_Gate (at least 20 minutes before the check-in, or a
  known position outside `AWAY_DISTANCE_METRES`). Everything else is a Walk_In,
  including every pre-spec check-in. `foundVia` is resolved on the server
  (`backend/src/features/check-in/found-via.ts`); a client-supplied value is
  ignored.
- **One Receipt, one home.** `computeReceipt` and `buildReceiptCopy`
  (`backend/src/features/reports/`) produce every owner-facing split: live
  panel, check-in badge, weekly digest, trial and renewal emails, Plans panel,
  boost scoreboard. No surface counts or phrases the split itself.
- **Measurement verbs only.** Copy says what was recorded, never what we
  caused. `BANNED_CAUSAL_VERBS` (`brought`, `drove`, `generated`, `boosted`)
  plus revenue, ticket and spend language stay out of owner copy, enforced by
  the honest-copy property test. Values below the Suppression_Floor say less
  rather than rendering a number, and a zero Receipt offers exactly one next
  step.

## Tonight and Going

Tonight is what a venue says will happen. Going is consumer intent. Neither is
presence, and neither may be dressed as presence (`honest-presence.md`).

- **Tonight is a Dated_Slot on the existing Music_Schedule**, business-wide like
  the weekly grid, within 14 days, headline max 60 chars, at most one featured
  get. A dated slot shadows the weekly slot on its date. No second schedule
  store.
- **Tonight renders regardless of the live-vibe flags.** Headline, start time
  and featured get show on the venue card, the detail Tonight block and the
  share snapshot. The detail label is "Expected tonight", below the
  Presence_Floor, so it never reads as a crowd.
- **Going never touches the live signal.** Pulse, momentum, beam brightness and
  `vibeRank` order are invariant under any Going count (property test).
- **Going is public only at `GOING_PUBLIC_THRESHOLD` (3) and only with a
  Tonight.** Below that the card shows nothing and only the detail block offers
  "Be the first to mark going". The owner-facing live panel shows the true
  count, including zero. Wording is "marked going", never "coming" or "will
  arrive".
- **Going rows expire on their own**, Monday 12:00 SAST after the digest pass
  that covers the night, so the weekly pass can still read them and no sweeper
  exists. They carry `userId` and nothing else, and the erasure worker deletes
  both rows of a pair.

## Casual-customer First-Get flow

The token-based casual-customer "First-Get" flow
(`backend/src/features/rewards/guest-claim.ts`) replaced the original
phone-based guest-claim model. Tokens are 8-character Crockford base32 (no I, L,
O, U). Phone-number and SMS paths are permanently banned: see
`no-sms-no-phone-auth.md`.
