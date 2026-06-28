# CLAUDE.md

## Project

Area Code: map-first social discovery app for South African cities.
Users check in at venues, earn rewards, see live activity on a map.
Three cities: Johannesburg, Cape Town, Durban.
Live at areacode.co.za.

## Architecture

Monorepo. pnpm workspaces. TypeScript everywhere. Serverless on AWS.

```
apps/web          Consumer app (React + Vite, mobile-first)
apps/mobile       Expo React Native (shares packages/)
apps/business     Business dashboard (React + Vite, responsive)
apps/admin        Admin panel (React + Vite, responsive)
apps/staff        Staff validator (React + Vite, mobile-first)
packages/shared   Hooks, stores, lib, types, constants
backend           Fastify monolith (Lambda + API Gateway)
infra             Terraform modules and environments
```

## Stack

- Frontend: React 18, Vite, Tailwind (CSS variables only), Zustand, i18next
- Backend: Fastify 5, DynamoDB, AWS Cognito (4 pools), SQS, SNS
- Infra: Lambda nodejs20.x arm64, API Gateway v2 (HTTP + WebSocket), S3, Amplify
- Auth: **Email/password and Google OAuth via Cognito Hosted UI for all four pools.**
  Phone-OTP code paths exist as dead code only and return `410 Gone` in prod.
  See `.kiro/steering/no-sms-no-phone-auth.md` — this is a hard architectural
  rule, do not revive phone auth without explicit founder approval.

## Commands

```bash
pnpm typecheck                        # TypeScript check
pnpm test                             # vitest run
pnpm --filter backend build:lambda    # esbuild Lambda bundles
pnpm --filter @area-code/web build    # vite build (web)

# End-to-end suite is a standalone package (not in the pnpm workspace):
cd tests/e2e && pnpm test             # Playwright across all four portals
```

## Testing

- Unit and logic tests: Vitest (`pnpm test`). Pure logic cores (ranking,
  gestures, check-in CTA, QR, toast admission, selection, camera) get fast-check
  property tests, tagged `Feature: <name>, Property N: <desc>`, min 100 runs.
- Default Vitest environment is node. Component tests opt into jsdom per file.
- Mapbox GL, WebSockets, and check-in calls are mocked. No network or WebGL.
- End-to-end: Playwright in `tests/e2e/`, sweeping consumer, business, staff,
  and admin. Structural checks (no horizontal scroll, CTA reachable, axe
  criticals); visual fidelity is verified manually.

## Platform Focus

- Consumer web + mobile: mobile-first, 375px baseline, touch targets
- Staff: mobile-first, simple validator UI
- Business: responsive, works on phone and desktop
- Admin: responsive, works on phone and desktop

## Writing Rules

- Never use em dashes. Use commas, periods, or restructure the sentence
- Never use emojis in system UI (nav, headings, buttons, labels)
- Keep comments short. No filler words
- No superlatives or hyperbole in docs or UI copy

## Code Limits

| Metric      | Warning | Hard limit |
| ----------- | ------- | ---------- |
| File size   | 300     | 400 lines  |
| Function    | 30      | 150 lines  |
| Component   | 200     | 300 lines  |
| Line length | 100     | 120 chars  |

## Styling Rules

- All colors via CSS variables. Never use Tailwind color classes directly
- Cards: `rounded-2xl`. Bottom sheets: `rounded-t-3xl`
- No CSS grid in shared components (breaks React Native). Flex only
- Buttons: `active:scale-95` for tactile feedback
- Inputs: `rounded-xl` with `focus:border-[var(--accent)]`
- Map fills 100dvh x 100dvw. No vertical scroll on map screen

## Code Rules

- Hooks above all conditional returns
- Disable buttons during API calls with loading state
- Clean up useEffect subscriptions on unmount
- Check `statusCode` on API errors, show specific messages
- Use `await app.register()` for Fastify plugins, never `void`
- One component per file
- No `any` in component props
- No inline business logic in components
- No mock data in production. All synthetic/hardcoded data returns must be inside a `DEV_MODE` guard. `DEV_MODE` is only true when `AREA_CODE_ENV === 'dev'` and `AREA_CODE_FORCE_LIVE` is not set. Never add mock fallbacks that run in production.

## Map Carousel (Consumer Web)

Hard rules for the Peek_Carousel and its camera. Breaking these reintroduces
bugs we already fixed.

- **Two scopes, one order.** `vibeRank` decides order (taste, aliveness, tier,
  live gets, distance, id). Scope decides membership only, never re-sorts by
  nearness. Default scope is `recommended` (citywide top venues, viewport
  independent). Switch to `area` (viewport-scoped) only on a real user pan or
  zoom. See `.kiro/steering/discovery-dna-vibe-over-convenience.md`.
- **Recompute order from user moves only.** Wire `notifyViewportChanged` to map
  `moveend`/`zoom` only when `e.originalEvent` is present. Never recompute on
  programmatic camera moves (the selection fly-to), or the order collapses to
  the active venue and the browse arrows gray out.
- **Idle bearing-drift pauses during camera moves.** `map.setBearing` is an
  instant jump that aborts an in-flight `flyTo`. The drift loop must check
  `map.isMoving()` and skip while a move animates, or selection fly-to never
  arrives (the no-snap bug).
- **Snap-zoom only when below `MIN_MARKER_ZOOM`.** On selection, force
  `MAP_ARRIVAL_ZOOM` only if the current zoom is below the marker threshold.
  Otherwise preserve the user's zoom (omit `zoom` from `flyTo`).
- **Cards are selection-only.** A card tap sets the Active_Venue and flies the
  camera, nothing else. Commit_Mode (details) opens only from the "View
  details" control. No card tap and no gesture (including swipe-up) opens
  details. Swipe-down dismisses; horizontal swipe steps the carousel.
- **Map tab re-tap toggles the carousel** via `selectionStore.toggleOpen`,
  wired through `BottomNav` `onReselect`.

## Gets (Rewards)

Gets are a free engagement layer, not a deals catalog. Belonging beats bargains:
a get is the cherry on top of vibe-first discovery, never the reason to open the
app. Hard rules.

- **No standalone gets/deals browse surface.** The consumer app is four tabs
  (Map, Ranks, Feed, Profile). There is no "Gets Near You" tab, screen, or
  deals list. Do not re-add one. Gets surface on the map (venue detail) and in
  the feed as a reward layer, discovered vibe-first, never a list to shop by
  discount size. A deals catalog inverts monetization (it rewards the biggest
  discounter, usually a non-paying venue) and breaks the discovery DNA.
- **Wallet lives in Profile.** Earned-but-unredeemed codes
  (`useUnclaimedRewards` + `RedemptionCodeCard`) render in `ProfileScreen` (web)
  and the profile tab (mobile). It is utility, a code to show staff, not a
  discovery surface.
- **Only proximity-gated reads.** The single consumer discovery read is
  `GET /v1/rewards/near-me` (plus the user's own `GET /v1/users/me/unclaimed-rewards`).
  No global events/offers feed, list, or search. Enforced by
  `backend/src/features/rewards/__tests__/no-global-events-feed.test.ts`.
- **Ranking mirrors the carousel.** `rankGetsByVibe`
  (`backend/src/features/rewards/ranking.ts`) orders by taste, aliveness,
  business tier, has-live-gets, distance, id, identical signal order to
  `vibeRank`. Tier participates (founder-approved) but sits below taste and
  aliveness, so a paid get must still be on-taste and alive to lead. Reach is
  the paid product; feed position is earned, never bought outright.

## Dependency Direction

Backend: handler calls service, service calls repository, repository calls DB.
Never skip layers. Cross-domain logic goes through shared interfaces.

Frontend: `apps/` imports from `packages/` only. `packages/shared` never imports
from `apps/` or feature modules. Features import from shared only.

## Four Auth Contexts

Each type has its own Cognito pool, auth store, token namespace.
No shared `useAuth()` hook. No role switching in a single store.

| Type     | Store             | Namespace   |
| -------- | ----------------- | ----------- |
| Consumer | consumerAuthStore | consumer:   |
| Business | businessAuthStore | business:   |
| Staff    | staffAuthStore    | staff:      |
| Admin    | adminAuthStore    | (admin app) |

## Backend Patterns

Handler order: JWT verify, role check, Zod validation, rate limit, service, DB, socket emit, return.

DynamoDB tables: users, nodes, checkins, rewards, businesses, app-data.
Table names from env vars with prod fallback defaults.

API style: camelCase JSON. Errors: `{ error, message, statusCode }`.
Auth: Bearer token. Rate limiting: DynamoDB TTL sliding window.

Never return raw errors. Use typed `AppError`.

## Database

DynamoDB pay-per-request. No Prisma, no RDS.

- app-data table: generic KV store (`pk: KV#{key}`, `sk: VALUE`)
- Cities: `pk: CITY#{slug}`, `sk: CITY#{slug}`
- Consent: `pk: USER#{id}`, `sk: CONSENT#{id}`
- Rate limits and OTP sessions use TTL for auto-expiry

## Real-Time

WebSocket API Gateway with Lambda handler.
Connection tracking in DynamoDB (websocket-connections table).
Route keys: `joinroom`, `leaveroom`, `presencejoin`, `presenceleave` (no colons).

Frontend: `packages/shared/lib/websocket.ts` singleton.
Falls back to no-op when `VITE_WEBSOCKET_URL` is not set.

## Infrastructure

All resources through Terraform. Never create manually.
Always `terraform plan` before `terraform apply`.

Lambda: nodejs20.x, arm64, 128MB default, 256MB workers, 512MB API.
Secrets in AWS Secrets Manager at `area-code/{env}/*`.

## Deployment

```bash
./scripts/deploy-serverless.ps1       # build + terraform + lambda upload
./scripts/update-all-amplify-apps.ps1 # Amplify env vars + trigger builds
git push origin master                # auto-triggers Amplify rebuilds
```

## Environment Variables

Backend (Lambda): AREA_CODE_ENV, table names, Cognito pool IDs + client IDs,
S3 bucket, SQS URLs, QR HMAC secret, VAPID keys, consent version.

Frontend (Amplify): VITE_API_URL, VITE_WEBSOCKET_URL, VITE_VAPID_PUBLIC_KEY.

## Naming

| Type            | Convention  | Example                |
| --------------- | ----------- | ---------------------- |
| Components      | PascalCase  | NodeMarker.tsx         |
| Hooks           | camelCase   | useCheckIn.ts          |
| Stores          | camelCase   | mapStore.ts            |
| Backend routes  | kebab-case  | /check-in              |
| DynamoDB tables | kebab-case  | area-code-prod-users   |
| Env vars        | UPPER_SNAKE | AREA_CODE_DB_URL       |
| Lambda names    | kebab-case  | area-code-prod-api     |
| Secrets         | slash-sep   | area-code/prod/qr-hmac |

## Common Gotchas

- DynamoDB table name env vars (`USERS_TABLE`, `NODES_TABLE`, etc.) must always be set. Fallbacks point to dev tables. Production Lambda sets them via Terraform. Never rely on defaults in prod.
- `awsLambdaFastify()` must be called BEFORE `app.ready()`
- API Gateway WebSocket route keys cannot contain colons
- PowerShell mangles JSON for AWS CLI. Use file-based JSON
- Amplify builds from git. Local changes need push to take effect
- Cognito custom attributes need app client read/write permissions
- **Phone-OTP routes exist as dead code.** They return `410 Gone` in prod.
  Do not "fix", "complete", or "modernise" them. See `.kiro/steering/no-sms-no-phone-auth.md`.
