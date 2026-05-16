# User Acceptance Testing Checklist

End-to-end manual test plan covering all four portals plus the consumer experience. Run through this on a staging or pre-production deployment before opening up real-user signups.

**How to use:** Tick each box as you verify. Note any gaps in the "Issues" section at the bottom. Re-run failed steps after a fix lands.

**Test accounts you'll need:**

- 1 consumer account (web)
- 1 business owner account (with a real venue)
- 1 staff member (invited by the business)
- 1 admin account
- A second consumer account (for follow/block testing)

---

## Cross-Cutting Smoke Test (do these first, ~5 min)

These prove the platform is alive end-to-end.

- [ ] **API health** — `curl https://api.areacode.co.za/health` returns `{"status":"ok","env":"prod",...}`
- [ ] **Public node list** — `curl https://api.areacode.co.za/v1/nodes/johannesburg` returns 200 with a non-empty `nodes` array
- [ ] **Consumer web loads** — `https://areacode.co.za` renders the map with at least one node visible
- [ ] **Business portal loads** — `https://business.areacode.co.za` reaches the login screen without a console error
- [ ] **Staff portal loads** — `https://staff.areacode.co.za` reaches the login screen
- [ ] **Admin portal loads** — `https://admin.areacode.co.za` reaches the login screen
- [ ] **No console errors** in any portal on initial load (open DevTools)
- [ ] **CORS works** — login on each portal does not throw a CORS error in the network tab
- [ ] **WebSocket connects** — open the consumer web; in DevTools network tab, the WSS connection establishes (status 101)

### Public legal pages & contact aliases (Google OAuth verification depends on these)

- [ ] **Privacy policy renders without login** — open an incognito window and visit `https://areacode.co.za/legal/privacy`. Document loads, no auth gate.
- [ ] **Terms of service renders without login** — same for `https://areacode.co.za/legal/terms`.
- [ ] **Privacy link visible on the home page** — `https://areacode.co.za` shows a "Privacy Policy" link in the footer of the unauthenticated landing page.
- [ ] **`privacy@areacode.co.za`** receives mail (test by sending one). Cited in the privacy policy.
- [ ] **`legal@areacode.co.za`** receives mail. Cited in the terms.
- [ ] **`support@areacode.co.za`** receives mail. Cited in the landing footer and Google OAuth consent screen.
- [ ] **Search Console domain verification** for `areacode.co.za` is in the "Verified" state under the Google account that owns the OAuth project (`reelagents91@gmail.com`).

---

## 1. Consumer Web (`https://areacode.co.za`)

### 1.1 Sign up & first launch

- [ ] **Email/password signup** — submit a new email and password; account is created
- [ ] **Google sign-in** — "Continue with Google" path completes and lands on the map
- [ ] **OTP back navigation** — during phone OTP step, pressing back returns to the phone entry screen with the number still populated
- [ ] **Onboarding carousel appears** on first signup: 5 steps (map, check-in, rewards, leaderboard, music)
- [ ] **Skip onboarding** — the skip button advances directly to the map
- [ ] **Onboarding does not re-appear** on subsequent logins
- [ ] **Privacy default is `friends_only`** — verify in profile → privacy settings

### 1.2 Map & discovery

- [ ] **Geolocation prompt** — browser asks for location; granting it centres the map on you
- [ ] **Denying location** still shows a default city map (Johannesburg by default)
- [ ] **Nodes render as markers** with correct category colours
- [ ] **Tap a node** opens the bottom sheet with name, category, distance, hours
- [ ] **Search venues** by name in the search overlay; results filter live as you type (300ms debounce)
- [ ] **No results** state shows when search matches nothing; clearing the input restores the full list
- [ ] **Live activity toasts** appear at the top when other users check in (if any are active)
- [ ] **Category filter bar** filters the map to selected categories only
- [ ] **Crowd vibe section** on a node sheet shows the music/vibe summary (if data exists)

### 1.3 Check-in

- [ ] **GPS check-in** — within range of a venue, the check-in button is enabled; tapping it succeeds
- [ ] **Out of range** — check-in shows `accuracy_insufficient` error; sheet stays open
- [ ] **No GPS permission** — check-in shows a clear "location required" error
- [ ] **QR check-in via deep link** — scanning a venue QR with phone camera opens `/qr/{slug}/{code}` in browser, lands on the QR check-in screen, and check-in succeeds
- [ ] **Tier progression toast** appears when crossing a threshold (e.g. 10th check-in = regular)
- [ ] **Check-in cooldown** — immediately checking in again at the same venue shows the cooldown error with a countdown
- [ ] **Streak counter** increments after a check-in on a new day; shows "at risk" if you missed yesterday

### 1.4 Profile & history

- [ ] **Profile screen** shows display name, tier badge, total check-ins, streak count
- [ ] **Tier progress bar** shows correct count and "X check-ins to next tier"
- [ ] **Check-in history** lists past visits with venue name, category, timestamp
- [ ] **History pagination** — scroll to the bottom; older entries load (cursor-based)
- [ ] **History error retry** — kill network mid-fetch; error toast appears with retry button
- [ ] **Music preferences** — set genre weights; they persist across sessions

### 1.5 Rewards

- [ ] **Rewards near me** lists active rewards from venues you've checked in at
- [ ] **Claim a reward** — tap claim; it moves to "claimed" state with a redemption code
- [ ] **Reward notification** — when a venue you've visited in the last 30 days publishes a new reward, a notification appears (web push if subscribed, in-app toast otherwise)
- [ ] **Push notification permission** — first claim triggers the notification priming sheet
- [ ] **No double-claim** — claiming the same reward twice shows "already claimed"

### 1.6 Social

- [ ] **Friends search** finds another user by display name
- [ ] **Send follow request** — appears in their inbox, status is "pending"
- [ ] **Accept follow** — both users appear in each other's followers/following
- [ ] **Friend check-in toast** appears (in real time) when a mutual follow checks in
- [ ] **Leaderboard** shows top users in your city for the week
- [ ] **Activity feed** shows recent check-ins from people you follow
- [ ] **Block a user** — they disappear from your feed/leaderboard; their toasts no longer appear

### 1.7 Privacy & safety

- [ ] **Switch privacy to public** — your check-ins emit identity in city toasts
- [ ] **Switch privacy to friends_only** — only mutual follows see your identity in toasts
- [ ] **Switch privacy to private** — no toast contains your identity at all
- [ ] **Block list** is editable; unblock restores visibility
- [ ] **Report a user** — submit a harassment report; admin sees it as high priority
- [ ] **No GPS coordinates** appear anywhere in the consumer-facing UI (verify in network responses)

### 1.8 Account management

- [ ] **Forgot password** — email is sent with reset code; reset succeeds
- [ ] **Logout** — session is cleared; protected screens redirect to login
- [ ] **Delete account** (in settings, if implemented) — account is disabled and data export is offered

### 1.9 Error handling

- [ ] **Network drop** during check-in — error toast shows "Connection lost. Check your internet…"
- [ ] **Server 500** — error boundary catches it; reload button is offered
- [ ] **Server 4xx** — specific message from the response body is shown (not generic)
- [ ] **No silent failures** — every action either succeeds visibly or shows an error

---

## 2. Business Portal (`https://business.areacode.co.za`)

### 2.1 Onboarding

- [ ] **Sign up** with email/password
- [ ] **Google sign-in** completes and returns to dashboard
- [ ] **Add Venue** flow — enter name, category, address (Google autocomplete works), claim status
- [ ] **Address geocoding** — entering a real address pins the right map location
- [ ] **Free trial banner** appears showing 14 days remaining; no card required
- [ ] **Pre-trial restrictions** — venue is hidden from public map until the trial starts (or is paid)

### 2.2 Live panel

- [ ] **Check-ins today counter** updates in real time
- [ ] **Pulse score gauge** renders
- [ ] **Live avatars row** populates with recent check-ins
- [ ] **Zero-state tips** display when there are fewer than 10 check-ins
- [ ] **No NodeEditorPanel here** (it now lives in Settings)

### 2.3 Venue editor (in Settings)

- [ ] **Venue list** — owner sees all their venues
- [ ] **Edit name/category** — saves and reflects on the public map
- [ ] **Edit address** — re-geocodes and updates the map pin
- [ ] **Photo upload** — JPG/PNG up to 2MB succeeds; preview updates immediately
- [ ] **Photo rejected** — non-JPG/PNG file shows "Only JPG or PNG allowed."
- [ ] **Photo too large** — over 2MB shows "Image must be under 2MB."
- [ ] **Photo removed** — Remove button deletes the image from S3 and clears the preview
- [ ] **Instagram handle** — saving `@venue` strips the `@` and persists; clearing it removes the field

### 2.4 Check-in detail panel

- [ ] **Date filter** — past 7 days returns expected count
- [ ] **Per-check-in row** shows display name, tier badge, visit frequency (first-time / returning / regular), timestamp
- [ ] **No PII** — no phone, email, or coordinates visible
- [ ] **Real-time append** — open the panel, then trigger a check-in from another browser; new row appears within seconds (WebSocket)

### 2.5 Rewards

- [ ] **Create a reward** — title, description, type, total slots, expiry
- [ ] **Edit a reward** — changes persist
- [ ] **Reward appears on consumer side** within 60s
- [ ] **Reward metrics panel** — shows claim rate, time-to-claim, redemption rate
- [ ] **Low-performance flag** appears when a reward has 0 claims after 7 days
- [ ] **Summary ranking** — all active rewards sorted by claim rate descending
- [ ] **Empty state** — clear "Create your first Get" CTA when no rewards exist

### 2.6 Staff management (in Settings)

- [ ] **Invite a staff member** — email + role (staff or manager); invite token is generated
- [ ] **Copy invite link** works
- [ ] **Share via WhatsApp** opens the WhatsApp deep link with prefilled message
- [ ] **Pending invite** displays with email and expiry
- [ ] **Staff accepts invite** — moves from "pending" to active; appears in staff list
- [ ] **Remove staff** — Cognito user is disabled; their tokens revoked
- [ ] **Manager role** can log into the business portal too; staff role cannot

### 2.7 Staff redemption attribution

- [ ] **StaffRedemptionPanel** — list of redemptions filtered by staff member
- [ ] **Filter dropdown** — selecting a staff member shows only their redemptions
- [ ] **Each row** shows staff name, reward title, timestamp

### 2.8 Subscription & billing

- [ ] **Plans panel** — Free trial, Starter, Pro tiers visible
- [ ] **Yoco checkout** — clicking Upgrade opens Yoco payment page
- [ ] **Successful payment** — webhook fires, plan upgrades, banner clears
- [ ] **Cancel subscription** — billing stops at end of period; venue remains visible until then
- [ ] **Trial-ended state** — after 14 days without upgrade, public visibility is removed; clear upgrade CTA

### 2.9 QR code

- [ ] **Generate QR Code** button creates a QR linking to `/qr/{slug}/{code}`
- [ ] **Auto-enables `qrCheckinEnabled`** on the node
- [ ] **QR scans correctly** from both the consumer web and a phone camera
- [ ] **Re-generation** invalidates the old code

### 2.10 Reports (intelligence)

- [ ] **Reports panel** lists generated weekly/monthly reports
- [ ] **Tier-gated** — free tier sees teaser, paid tiers see full report
- [ ] **PII anonymized** — no display names or user IDs in the report payload
- [ ] **Audience demographics** render
- [ ] **Peak hours chart** renders
- [ ] **Music profile** renders if check-ins have music sessions

### 2.11 Audience & boost

- [ ] **Audience panel** shows aggregated stats (total customers, return rate, avg tier)
- [ ] **Boost panel** shows current pulse score and recent surges
- [ ] **No raw user data** anywhere

---

## 3. Staff Portal (`https://staff.areacode.co.za`)

### 3.1 Authentication

- [ ] **Invite link** opens the StaffInvite screen with prefilled email
- [ ] **Set password** completes and lands on StaffHome
- [ ] **Login with email/password** works after invite acceptance
- [ ] **Google sign-in** works (if email matches Cognito user)
- [ ] **OTP back nav** — during email/OTP, back button returns to email entry with state preserved
- [ ] **Logout** revokes tokens and returns to login

### 3.2 QR scanner

- [ ] **"Scan QR Code" button** prompts for camera permission
- [ ] **Camera grants** — viewfinder appears; valid QR code is detected within 2 seconds
- [ ] **Camera denied** — error message "Camera access denied…" with manual entry fallback
- [ ] **No BarcodeDetector (Safari/Firefox)** — jsQR fallback still scans
- [ ] **Native BarcodeDetector (Chrome/Edge)** — uses native scanner (verify ~250ms scan interval)
- [ ] **Race condition** — opening scanner immediately after closing it does not freeze the video

### 3.3 Manual code entry

- [ ] **Type code** in the input field; pressing Enter triggers preview
- [ ] **Lowercase input** auto-uppercases
- [ ] **Special characters** stripped to alphanumeric only

### 3.4 Redemption preview

- [ ] **Valid code** — preview shows reward title, type, description, consumer display name, tier
- [ ] **Invalid code** — clear "invalid_code" message, no preview shown
- [ ] **Already redeemed** — clear "already_redeemed" message
- [ ] **Expired code** — clear "expired_code" message
- [ ] **Confirm button** is required to proceed (no auto-confirm)
- [ ] **Cancel** returns to scan/entry screen

### 3.5 Confirmation & result

- [ ] **Confirm redemption** — success screen with reward title and timestamp
- [ ] **3-second hold** on success screen before allowing next scan
- [ ] **Failure path** — shows specific error reason, button to retry
- [ ] **Staff attribution** — admin/business sees this redemption credited to the logged-in staff member

### 3.6 Recent redemptions

- [ ] **Recent redemptions list** on StaffHome — last 10 successful redemptions by this staff member
- [ ] **Updates after each new redemption** without refresh
- [ ] **Logout clears the list**

---

## 4. Admin Portal (`https://admin.areacode.co.za`)

### 4.1 Authentication

- [ ] **Email/password login** — admin pool only; consumer/business credentials rejected
- [ ] **Google sign-in** for admin (if configured)
- [ ] **Wrong pool credentials** — clear error, no token issued
- [ ] **Logout** clears tokens

### 4.2 Dashboard overview

- [ ] **Default landing** is DashboardOverview after login
- [ ] **Total consumers** count is correct
- [ ] **Total businesses** count is correct
- [ ] **Total check-ins (all-time + today)** displays
- [ ] **Active rewards** count
- [ ] **Pending reports** count (with badge if > 0)
- [ ] **Pending erasure requests** count
- [ ] **Unreviewed abuse flag count** displayed
- [ ] **Auto-refresh every 60s** — observe count change after a new check-in elsewhere

### 4.3 Consumer management

- [ ] **List consumers** with email, display name, tier, status
- [ ] **Search by email/name**
- [ ] **View consumer detail** — check-in history, reports against them, reports they filed
- [ ] **Disable consumer** — confirmation dialog, action creates audit log
- [ ] **Disabled user blocked** — they cannot check in or claim rewards (verify on consumer web)
- [ ] **Cognito tokens revoked** — disabled user is logged out within seconds

### 4.4 Business management

- [ ] **List businesses** with owner email, plan tier, node count, status
- [ ] **Search**
- [ ] **View business detail** — owner, nodes, payment history
- [ ] **Disable business** — confirmation, audit log entry
- [ ] **Disabled business** — all their nodes set to `isActive=false`; disappear from public map within 60s

### 4.5 Node management

- [ ] **List nodes** with name, category, business, claim status
- [ ] **Search by name/slug**
- [ ] **Edit node** — name, category, active state
- [ ] **Empty state** copy is concise (no over-explanation)
- [ ] **Audit log entry** is created on every edit

### 4.6 Abuse flag dashboard

- [ ] **List unreviewed flags** ordered by created date desc
- [ ] **High-priority flags** (harassment/stalking) visually distinguished
- [ ] **Real-time append** via `abuse:new_flag` WebSocket — new flags appear without refresh
- [ ] **Click flag** — detail view shows type, affected user, evidence
- [ ] **Mark reviewed** — flag moves out of the unreviewed queue, audit log entry created
- [ ] **Take action from flag** — disable user / reset flags actions work, audit log created
- [ ] **Unreviewed count badge** on nav tab updates after marking reviewed

### 4.7 Audit trail viewer

- [ ] **Chronological list** of admin actions
- [ ] **Filter by admin ID**
- [ ] **Filter by action type** (disable_user, disable_business, node_update, etc.)
- [ ] **Filter by date range**
- [ ] **Each entry** shows admin email, action, target entity, before/after state, timestamp
- [ ] **Pagination** — load older entries with cursor

### 4.8 Report queue (admin moderation)

- [ ] **Pending consumer reports** listed
- [ ] **Resolve report** — closes it, optional action (warn / disable user)
- [ ] **Audit log** created for each resolution

### 4.9 Consent audit

- [ ] **Consent records** list shows user ID, version, timestamp
- [ ] **Filter by version** (e.g., `v1.0` vs `v1.1`)
- [ ] **Export to CSV** if implemented

### 4.10 IAM (admin user management)

- [ ] **List admin users** with role
- [ ] **Invite a new admin** — email, role (super_admin / admin / read_only)
- [ ] **Role changes** are audit-logged
- [ ] **Read-only admin** can view but not action (disable buttons grey out)

### 4.11 Archetype management

- [ ] **List archetypes** with weights
- [ ] **Edit weights** persists
- [ ] **Test tool** — paste a venue's check-in profile, see resolved archetype
- [ ] **Genre weight editor** — adjust per-genre scoring

---

## 5. Cross-Portal Real-Time Tests

These verify WebSocket events flow correctly across portals.

- [ ] **Consumer checks in** → business "Live panel" check-in count increments within 5s
- [ ] **Consumer checks in** → business "Check-in detail" panel appends a new row within 5s
- [ ] **Business creates a reward** → consumer rewards screen shows it within 60s (after cache refresh)
- [ ] **Consumer crosses a tier threshold** → consumer gets `tier:changed` toast immediately
- [ ] **Mutual follow check-in** → other follower gets a friend toast in real time
- [ ] **Admin disables a user** → that user's open tab in consumer web logs them out within 60s on next API call
- [ ] **Staff redeems a reward** → business StaffRedemptionPanel shows the new redemption in real time
- [ ] **New abuse flag created** → admin AbuseFlagDashboard appends it without refresh

---

## 6. Performance & Reliability

- [ ] **Cold start** — first API call after 15min idle returns within 3s (Lambda cold start tolerable)
- [ ] **Map loads** in under 5s on a 4G connection (test with throttled DevTools)
- [ ] **No memory leaks** — leave consumer web open for 30 min; memory does not climb past 200MB
- [ ] **WebSocket reconnect** — kill and restore network; socket reconnects within 30s
- [ ] **No 500s** in CloudWatch logs during the full test run
- [ ] **No DLQ messages** — `area-code-prod-reward-eval-dlq` and `area-code-prod-push-sender-dlq` have 0 visible messages

---

## 7. Security Spot Checks

- [ ] **HTTPS only** — `http://areacode.co.za` redirects to `https://`
- [ ] **HSTS header** present on `api.areacode.co.za` responses (`Strict-Transport-Security`)
- [ ] **CORS** rejects requests from origins not on the allowlist (test with curl `-H "Origin: https://evil.com"`)
- [ ] **Auth required** — calling `GET /v1/users/me/check-in-history` without a token returns 401
- [ ] **Cross-pool tokens rejected** — using a consumer token on a business endpoint returns 403
- [ ] **Self-block returns 400** — `POST /v1/users/me/block/{my-own-id}`
- [ ] **Rate limit on auth** — > 20 requests in 5 min from one IP gets 429 (when WAF is attached)
- [ ] **Yoco webhook signature** — sending an unsigned webhook returns 400

---

## 8. Mobile Responsiveness

Test each portal at common viewport sizes:

- [ ] **375×667** (iPhone SE) — all CTAs reachable, no horizontal scroll
- [ ] **414×896** (iPhone 11) — bottom nav doesn't overlap content
- [ ] **768×1024** (iPad portrait) — admin tables don't wrap awkwardly
- [ ] **1440×900** (laptop) — main content doesn't span full width on huge screens
- [ ] **Touch targets** are at least 44×44px on mobile

---

## 9. Accessibility Spot Checks

- [ ] **Tab navigation** through every screen reaches all interactive elements
- [ ] **Focus indicators** are visible (not removed via `outline: none`)
- [ ] **Screen reader** announces tier badges, toast messages, error states
- [ ] **Colour contrast** for text on backgrounds passes WCAG AA (use a contrast checker tool)
- [ ] **Form labels** are present and associated with inputs
- [ ] **Skip-to-content link** present on each portal
- [ ] **No reliance on colour alone** — error states have icons or text, not just red

> Full WCAG validation requires manual screen-reader testing (NVDA/JAWS/VoiceOver) and expert review. Spot checks here cover the obvious gaps.

---

## 10. Final Sign-off

- [ ] All sections above completed
- [ ] All issues logged in the table below
- [ ] Severity-1 issues (broken core flows) have fixes merged
- [ ] Severity-2 issues (UX gaps) have tickets and target dates
- [ ] CloudWatch shows < 0.1% error rate during the test window
- [ ] Sentry shows no unhandled errors during the test window

---

## Issues Log

| #   | Severity | Portal | Section | Description | Status |
| --- | -------- | ------ | ------- | ----------- | ------ |
|     |          |        |         |             |        |

**Severity guide:**

- **S1 (blocker):** Core flow broken (signup, check-in, redemption, payment). Fix before launch.
- **S2 (major):** Important feature broken or missing UX feedback. Fix before launch if possible, otherwise day-1 hotfix.
- **S3 (minor):** Cosmetic, edge-case, or nice-to-have. Backlog.

---

## Tester Sign-off

| Tester | Role | Date | Signature |
| ------ | ---- | ---- | --------- |
|        |      |      |           |
|        |      |      |           |

---

**Last updated:** 15 May 2026  
**Next review:** After every major release.
