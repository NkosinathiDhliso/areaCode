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

## Casual-customer First-Get flow

The token-based casual-customer "First-Get" flow
(`backend/src/features/rewards/guest-claim.ts`) replaced the original
phone-based guest-claim model. Tokens are 8-character Crockford base32 (no I, L,
O, U). Phone-number and SMS paths are permanently banned: see
`no-sms-no-phone-auth.md`.
