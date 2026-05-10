# Requirements Document

## Introduction

Production Hardening Sprint is a 1-day focused effort to close 12 critical gaps in the Area Code platform — a map-first venue intelligence platform for South African cities (Johannesburg, Cape Town, Durban). The platform connects consumers who discover and check in to venues with businesses who pay subscriptions and boosts for visibility. This sprint addresses missing revenue visibility for admins, the core visual hierarchy mechanic (dynamic map markers), staff tooling, proximity notifications, boost ROI, billing history, pricing integrity, error resilience, WebSocket verification, search enhancement, onboarding completion, and i18n coverage. All work must remain strictly serverless (Lambda, DynamoDB PAY_PER_REQUEST, API Gateway, SQS, S3, Cognito) with no always-on resources.

## Execution Model

Before implementing Requirements 1–15, perform a discovery sweep of every file in the codebase. Fix all security vulnerabilities, broken imports, unhandled promise rejections, raw `throw new Error()` statements, `ScanCommand` usage, hardcoded secrets, and coding standard violations inline. Document all fixes as sub-items under Requirement 16. This is not a two-phase "audit then implement" workflow — issues are fixed the moment they are found.

**Execution Order:** Req 16 (discovery sweep) → Req 25 (shared UI components) → Req 11 (error handling) → Req 24 (observability) → Req 21 (webhook security) → Req 22 (authorization) → Req 12 (WebSocket) → Req 1–2 (revenue) → Req 9 (billing) → Req 28 (payment trust UX) → Req 4–6 (staff) → Req 3 + Req 30 (markers + performance budget) → Req 26 (BottomSheet + NodeDetailSheet) → Req 8 (boost ROI) → Req 7 (proximity) → Req 10 (PAYG rename) → Req 13 + Req 23 + Req 27 (search + image safety + search polish) → Req 17 (header image) → Req 18 (Instagram) → Req 19 (directions chooser) → Req 29 (business command center) → Req 14 (onboarding) → Req 15 (i18n) → Req 20 (UX polish pass) → Req 31 (verification).

## Glossary

- **Admin_Revenue_Dashboard**: The admin panel screen that displays revenue metrics including MRR, boost revenue, active subscriptions by tier, trial conversion rate, and PAYG revenue with date range filters and per-business breakdown.
- **Payment_Record**: A DynamoDB item storing a successful Yoco payment event with amount, type (subscription or boost), plan tier, businessId, and timestamp. Stored with dual-write pattern for both per-business and per-month aggregation queries.
- **Map_Renderer**: The React component responsible for rendering venue markers on the consumer map with dynamic sizing, glow effects, and animations based on pulse score and boost state.
- **Pulse_Score**: A numeric value (0–unbounded) representing a venue's current activity level, computed as `dailyCount * 5 + uniqueUsers * 2`. Scores regularly exceed 100 for active venues.
- **Staff_App**: The mobile-first React web application used by venue staff to validate reward redemptions, view incoming check-ins, and track daily statistics.
- **Staff_Store**: The Zustand store managing staff-side state including live queue, recent redemptions, and today's statistics.
- **Proximity_Module**: The client-side module within the consumer app that evaluates the consumer's geolocation against cached node locations and pulse states, triggering in-app proximity banners without sending GPS coordinates to the backend.
- **Boost_ROI_Panel**: The business dashboard component that displays check-in uplift, baseline comparison, and cost data for past boost purchases.
- **Billing_Panel**: The business dashboard component that displays payment history with date, description, amount, and status for all Yoco transactions.
- **Search_Engine**: The consumer-facing search component that performs full-text matching across venue name and category, sorted by proximity, with pulse state badges.
- **Onboarding_Flow**: The first-time consumer experience covering location permission, notification priming, music connection, and first check-in tutorial.
- **WebSocket_Health**: The system's ability to maintain, reconnect, and monitor real-time WebSocket connections across all clients.
- **Error_Handler**: The standardized error handling layer using AppError class with proper Zod validation, rate limiting, and security headers across all endpoints.
- **Node**: A venue listing on the Area Code map, owned by a business, with location, category, pulse score, and boost state.
- **MRR**: Monthly Recurring Revenue — the sum of all active subscription payments normalized to a monthly value.
- **Yoco**: The South African payment provider used for all subscription and boost transactions.
- **ZAR**: South African Rand — the currency used for all platform transactions.
- **PAYG**: Pay As You Go — being renamed to "Flex Daily" to reflect the actual flat daily rate pricing model.
- **AppError**: The standardized error class used across all backend handlers to ensure consistent error response format and logging.
- **STATE_THRESHOLDS**: The pulse state classification boundaries: dormant (0), quiet (1+), active (11+), buzzing (31+), popping (61+).

## Requirements

### Requirement 1: Revenue Payment Storage

**User Story:** As an admin, I want every successful Yoco payment stored with full metadata, so that the platform can compute revenue metrics and display billing history.

#### Acceptance Criteria

1. WHEN a Yoco webhook delivers a successful payment event, THE Payment_Record SHALL be stored in DynamoDB with amount (in ZAR cents), type (subscription or boost), plan tier, businessId, nodeId (for boosts), and timestamp.
2. THE Payment_Record SHALL use a dual-write pattern: a primary item with partition key `PAYMENT#<businessId>` and sort key `<timestamp>#<paymentId>` for per-business billing queries, AND a secondary item with partition key `REVENUE#<YYYY-MM>` and sort key `<timestamp>#<paymentId>` for admin revenue aggregation across all businesses without requiring a table scan.
3. IF a duplicate Yoco webhook is received (same paymentId), THEN THE Payment_Record storage SHALL be idempotent and not create a duplicate record.
4. THE Payment_Record SHALL include a `paymentProvider` field set to "yoco" and a `currency` field set to "ZAR".

### Requirement 2: Admin Revenue Dashboard Metrics

**User Story:** As an admin, I want to see MRR, boost revenue, active subscriptions by tier, trial conversion rate, and PAYG revenue on the dashboard, so that I can monitor platform financial health.

#### Acceptance Criteria

1. THE Admin_Revenue_Dashboard SHALL display MRR computed as the sum of all active subscription amounts normalized to monthly values.
2. THE Admin_Revenue_Dashboard SHALL display total boost revenue for the selected date range.
3. THE Admin_Revenue_Dashboard SHALL display active subscription counts grouped by tier (starter, growth, pro, payg).
4. THE Admin_Revenue_Dashboard SHALL display trial conversion rate as the percentage of businesses that converted from starter to a paid tier within 30 days.
5. THE Admin_Revenue_Dashboard SHALL display PAYG (Flex Daily) revenue for the selected date range.
6. THE Admin_Revenue_Dashboard SHALL provide date range filters (today, this week, this month, custom range) for all revenue metrics.
7. THE Admin_Revenue_Dashboard SHALL provide a per-business revenue breakdown table showing business name, plan, total paid, and last payment date.
8. THE Admin_Revenue_Dashboard SHALL query revenue data using the `REVENUE#<YYYY-MM>` partition key pattern, never using a table scan.

### Requirement 3: Dynamic Map Marker Sizing

**User Story:** As a consumer, I want to see venue markers that visually grow with activity level, so that I can instantly identify the busiest venues on the map.

#### Acceptance Criteria

1. THE Map_Renderer SHALL compute marker radius using linear interpolation from BASE_RADIUS (8px) to MAX_RADIUS (28px) based on the venue's Pulse_Score, normalized using `Math.min(pulseScore / 200, 1)` to allow headroom for high-activity venues whose scores regularly exceed 100.
2. THE Map_Renderer SHALL apply a glow shadow effect that intensifies proportionally with the normalized Pulse_Score (no glow at score 0, maximum glow at normalized value 1.0).
3. WHILE a Node has an active boost, THE Map_Renderer SHALL display a gold ring around the marker, enforce a minimum radius floor of 18px regardless of Pulse_Score, and apply a continuous pulsing animation.
4. WHILE a Node is in "popping" pulse state (score >= 61 per STATE_THRESHOLDS), THE Map_Renderer SHALL apply a breathing scale animation (1.0 to 1.15 scale over 2 seconds, repeating).
5. THE Map_Renderer SHALL ensure all markers have a minimum touch target of 44px (accessible tap area) regardless of visual radius.
6. THE Map_Renderer SHALL render markers in z-order by Pulse_Score so that higher-activity venues appear above lower-activity venues.

### Requirement 4: Staff App Live Queue

**User Story:** As a staff member, I want to see incoming check-ins in real time, so that I can greet customers and manage the venue flow.

#### Acceptance Criteria

1. WHEN the Staff_App connects, THE Staff_App SHALL join the business WebSocket room and subscribe to check-in events for the assigned node.
2. WHEN a consumer checks in at the staff member's assigned node, THE Staff_App SHALL display an incoming check-in card showing consumer display name, tier badge, and timestamp within 2 seconds.
3. THE Staff_App SHALL display a live queue of the 20 most recent check-ins for the current session, ordered by most recent first.
4. THE Staff_App SHALL display a "Today's Stats" bar showing total check-ins today, total redemptions today, and current pulse state.

### Requirement 5: Staff App Reward Validation

**User Story:** As a staff member, I want to validate reward redemptions via QR scan or manual code entry with clear feedback, so that I can efficiently process customer rewards.

#### Acceptance Criteria

1. THE Staff_App SHALL provide a QR scanner using the device camera (rear-facing) that extracts redemption codes from Area Code QR URLs.
2. THE Staff_App SHALL provide a manual code input field accepting the full 32-character hexadecimal token as a fallback when camera access is unavailable.
3. WHEN a valid code is scanned or entered, THE Staff_App SHALL display a preview card showing reward title, type, description, consumer name, and consumer tier before confirmation.
4. WHEN a redemption is confirmed successfully, THE Staff_App SHALL play a success sound, trigger device haptic feedback (if available), and display a green success screen for 3 seconds.
5. IF a redemption fails (expired, already redeemed, or invalid code), THEN THE Staff_App SHALL play an error sound, trigger a short haptic buzz, and display a red error screen with the specific failure reason.
6. THE Staff_App SHALL maintain a "Recent Redemptions" list showing the last 50 redemptions with code, reward title, timestamp, and status, filterable by status (success or failed).

### Requirement 6: Staff Store State Management

**User Story:** As a developer, I want a dedicated Zustand store for staff state, so that the staff app has clean separation of concerns and reactive updates.

#### Acceptance Criteria

1. THE Staff_Store SHALL manage live queue state (array of check-in events), recent redemptions (array of redemption records), today's stats (check-ins count, redemptions count, pulse state), and WebSocket connection status.
2. THE Staff_Store SHALL expose actions to add a check-in to the queue, add a redemption, update today's stats, and reset state on logout.
3. WHEN the WebSocket connection drops, THE Staff_Store SHALL update connection status to "disconnected" and trigger reconnection with exponential backoff.

### Requirement 7: Proximity Notifications (Client-Side)

**User Story:** As a consumer, I want to be notified when I am near a buzzing venue, so that I can discover active spots nearby.

#### Acceptance Criteria

1. WHEN a consumer's geolocation updates on the client, THE Proximity_Module SHALL compare the consumer's coordinates against cached node locations and their last-known pulse states (already available from the map data loaded via the existing nodes API). No GPS coordinates SHALL be sent to the backend for proximity evaluation.
2. IF a Node within 500 metres has pulse state "buzzing" or "popping", THE Proximity_Module SHALL display an in-app proximity banner showing the venue name, current pulse state, and distance.
3. THE Proximity_Module SHALL debounce notifications to a maximum of once per 15 minutes per Node per consumer, tracked in client-side storage.
4. THE Proximity_Module SHALL respect the consumer's notification opt-in preference stored locally and send no notification if the consumer has opted out.
5. THE Proximity_Module SHALL trigger web push notifications client-side using the existing Service Worker and cached venue data when the app is in the background, without sending GPS coordinates to the backend.

### Requirement 8: Boost ROI Panel

**User Story:** As a business owner, I want to see whether my boost purchases drove additional check-ins, so that I can make informed decisions about future boosts.

#### Acceptance Criteria

1. THE Boost_ROI_Panel SHALL display a "Past Boosts" section listing all completed boosts for the selected node with date, duration, check-ins during boost window, uplift percentage versus baseline, and cost in ZAR.
2. THE Boost_ROI_Panel SHALL compute baseline as the average check-in count for the same time window across the prior 4 weeks.
3. THE Boost_ROI_Panel SHALL compute uplift percentage as ((boost_checkins - baseline) / baseline) * 100, displayed as a positive or negative percentage.
4. IF fewer than 2 weeks of historical data exist for baseline computation, THEN THE Boost_ROI_Panel SHALL display "Insufficient data for comparison" instead of uplift percentage.

### Requirement 9: Business Billing History

**User Story:** As a business owner, I want to see my payment history in the dashboard, so that I can track my spending and have records for accounting.

#### Acceptance Criteria

1. THE Billing_Panel SHALL display a payment history table with columns: date, description (plan name or boost duration), amount in ZAR, and payment status (successful, failed, pending).
2. THE Billing_Panel SHALL retrieve payment records from a `GET /v1/business/me/billing` endpoint, paginated with 20 records per page, sorted by date descending.
3. THE Billing_Panel SHALL be accessible via a "Billing" tab in the BusinessDashboard navigation.
4. THE Billing_Panel SHALL display the current active plan name and next billing date at the top of the panel.

### Requirement 10: PAYG Pricing Rename

**User Story:** As a product owner, I want the PAYG plan renamed to "Flex Daily" with an accurate description, so that pricing communication matches the actual billing model.

#### Acceptance Criteria

1. THE PlansPanel SHALL display the plan name as "Flex Daily" instead of "Pay As You Go".
2. THE PlansPanel SHALL display the plan description as "Low daily rate, no commitment" instead of any per-check-in pricing language.
3. THE shared types definition SHALL use the identifier "flex_daily" for this plan tier in all new code while maintaining backward compatibility with existing "payg" data.
4. THE SALES_PITCH.md documentation SHALL reflect the updated plan name and description.

### Requirement 11: Error Handling and Resilience

**User Story:** As a platform operator, I want comprehensive error handling across all services, so that the platform degrades gracefully under failure conditions.

#### Acceptance Criteria

1. THE Error_Handler SHALL ensure all backend route handlers use Zod schema validation on request body, query parameters, and path parameters.
2. THE Error_Handler SHALL ensure all public API endpoints have rate limiting applied (not only the check-in endpoint).
3. THE Error_Handler SHALL ensure all thrown errors use the AppError class with appropriate HTTP status codes and error codes — no raw `throw new Error()` statements.
4. THE Error_Handler SHALL ensure no unhandled promise rejections exist in WebSocket event handlers, SQS message processors, or notification dispatch functions.
5. THE Error_Handler SHALL ensure no DynamoDB ScanCommand usage exists in production code — only QueryCommand with appropriate indexes.
6. THE Error_Handler SHALL ensure CORS configuration allows only the defined frontend origins.
7. THE Error_Handler SHALL ensure helmet security headers are applied to all HTTP responses.
8. IF any service call fails within a request handler, THEN THE Error_Handler SHALL return a structured error response with error code, message, and request ID without exposing internal stack traces.

### Requirement 12: WebSocket Health Verification

**User Story:** As a platform operator, I want to verify WebSocket reliability and monitor connection health, so that real-time features work consistently.

#### Acceptance Criteria

1. THE WebSocket_Health system SHALL implement client-side reconnection with exponential backoff (initial delay 1 second, maximum delay 30 seconds, with jitter).
2. THE WebSocket_Health system SHALL detect and clean up stale server-side connections that have not sent a heartbeat within 60 seconds.
3. THE WebSocket_Health system SHALL expose a `GET /v1/health/websocket` endpoint returning current active connection count, connections by room type, and uptime.
4. THE Admin_Revenue_Dashboard SHALL display an "Active WebSocket Connections" metric card showing the current connection count.

### Requirement 13: Consumer Search Enhancement

**User Story:** As a consumer, I want to search venues by name or category and see results ranked by proximity with activity indicators, so that I can quickly find relevant nearby venues.

#### Acceptance Criteria

1. THE Search_Engine SHALL perform full-text matching across Node name and category fields.
2. WHEN the consumer's location is available, THE Search_Engine SHALL sort results by proximity (nearest first).
3. THE Search_Engine SHALL display a pulse state badge (dormant, quiet, active, buzzing, popping) on each search result.
4. THE Search_Engine SHALL return results within 500 milliseconds of query submission.
5. WHEN no results match the query, THE Search_Engine SHALL display an empty state message suggesting broader search terms.

### Requirement 14: Onboarding Flow Completion

**User Story:** As a first-time consumer, I want a guided onboarding experience, so that I grant necessary permissions and understand how to use the app.

#### Acceptance Criteria

1. THE Onboarding_Flow SHALL present a location permission request screen explaining why location access improves the experience, with a "Grant Access" button that triggers the browser or device permission prompt.
2. THE Onboarding_Flow SHALL present a notification permission priming screen explaining what notifications the user will receive, with "Enable" and "Skip" options.
3. THE Onboarding_Flow SHALL present a music connection prompt explaining how music preferences personalize venue recommendations, with "Connect" and "Skip" options.
4. THE Onboarding_Flow SHALL present a first check-in tutorial screen explaining how to check in, earn rewards, and climb tiers, with a "Got it" dismissal button.
5. WHEN all onboarding steps are completed or skipped, THE Onboarding_Flow SHALL mark the consumer's profile as onboarded and not show the flow again.

### Requirement 15: Internationalization Completeness

**User Story:** As a platform operator, I want all user-facing strings wrapped in translation functions, so that the platform can be localized to additional languages in the future.

#### Acceptance Criteria

1. THE i18n system SHALL have all user-facing strings across all apps (web, mobile, business, admin, staff) wrapped in `t()` translation function calls.
2. THE i18n system SHALL have all error messages returned to users wrapped in translation keys.
3. THE i18n system SHALL have all toast notification messages wrapped in translation keys.
4. THE i18n system SHALL have all empty state messages wrapped in translation keys.
5. THE i18n system SHALL have all form validation messages wrapped in translation keys.

### Requirement 16: Code Quality and Discovery Sweep

**User Story:** As a developer, I want the codebase free of dead code, broken references, security holes, and TypeScript errors, so that the platform is maintainable and production-ready.

#### Acceptance Criteria

1. THE codebase SHALL contain no TypeScript compilation errors across all apps and packages.
2. THE codebase SHALL contain no files exceeding 300 lines (split into smaller modules where exceeded).
3. THE codebase SHALL contain no `any` type annotations in component props or function parameters.
4. THE codebase SHALL contain no inline business logic in React components (extracted to hooks or service functions).
5. THE codebase SHALL contain no mock data or placeholder data in production code paths — delete any mock/placeholder data found rather than guarding it behind feature flags.
6. THE codebase SHALL contain no hardcoded secrets or API keys (all secrets via environment variables or Secrets Manager).
7. THE codebase SHALL follow the handler → service → repository → DB dependency direction in all backend modules.
8. THE codebase SHALL have all useEffect hooks with proper cleanup functions for subscriptions and timers.
9. THE codebase SHALL have all interactive buttons disabled during pending API calls to prevent double-submission.
10. THE codebase SHALL use CSS variables for all color values (no hardcoded hex or rgb values except in CSS variable definitions).
11. THE discovery sweep SHALL fix all security vulnerabilities, broken imports, unhandled promise rejections, raw `throw new Error()` statements, `ScanCommand` usage, and coding standard violations inline during the scan — not collected into a list for later.

### Requirement 17: Business Node Header Image Upload

**User Story:** As a business owner, I want to upload a single header image for my venue, so that my node looks premium and inviting when consumers view it on the map.

#### Acceptance Criteria

1. THE NodeEditorPanel SHALL provide an image upload control that accepts exactly one header image per node (JPEG or PNG, max 2MB).
2. WHEN a business owner uploads a header image, THE backend SHALL generate a presigned S3 PUT URL scoped to the node's ID, and the client SHALL upload directly to S3 using that URL.
3. THE backend SHALL store the S3 object key on the node record as `headerImageKey` and serve it via a presigned GET URL or CloudFront URL when the node is fetched.
4. IF a node already has a header image and the business uploads a new one, THE backend SHALL replace the existing image (delete the old S3 object) to maintain exactly one image per node.
5. THE NodeDetailSheet in the consumer app SHALL display the header image as a full-width banner at the top of the sheet (aspect ratio 16:9, object-fit cover, rounded-t-3xl to match bottom sheet styling).
6. IF no header image exists for a node, THE NodeDetailSheet SHALL display a gradient placeholder using the node's category color.

### Requirement 18: Instagram Handle Integration

**User Story:** As a business owner, I want to add my Instagram handle to my venue listing, so that consumers can easily view my menu, stories, and vibe.

#### Acceptance Criteria

1. THE NodeEditorPanel SHALL provide an Instagram handle input field (prefixed with @, alphanumeric + underscores + periods, max 30 characters) that the business owner can optionally fill in.
2. THE backend SHALL store the Instagram handle on the node record as `instagramHandle` (without the @ prefix).
3. THE NodeDetailSheet SHALL display an Instagram button (Instagram logo icon) below the check-in button when the node has an `instagramHandle` set.
4. WHEN a consumer taps the Instagram button, THE app SHALL open the Instagram profile URL (`https://instagram.com/<handle>`) in the device's default browser or the Instagram app if installed.
5. IF no Instagram handle is set for a node, THE NodeDetailSheet SHALL NOT render the Instagram button.

### Requirement 19: Map Directions App Chooser

**User Story:** As a consumer, I want to choose which map app opens when I tap directions, so that I can use my preferred navigation app (Google Maps, Waze, Apple Maps) instead of being locked to one.

#### Acceptance Criteria

1. WHEN a consumer taps the "Directions" button on the NodeDetailSheet, THE app SHALL display a bottom sheet or action menu listing available map apps: Google Maps, Waze, and Apple Maps (on iOS) or Google Maps and Waze (on Android/web).
2. THE directions chooser SHALL construct the correct deep link URL for each map app using the node's latitude and longitude coordinates.
3. WHEN the consumer selects a map app from the chooser, THE app SHALL open the selected map app's directions URL in a new tab or via the native app deep link.
4. THE directions chooser SHALL remember the consumer's last-used map app preference in local storage and pre-select it on subsequent taps.
5. IF only one map app is available on the device, THE app SHALL open it directly without showing the chooser.

### Requirement 20: UX Polish Pass — Premium Visual System

**User Story:** As a consumer and business owner, I want the app to feel premium, intentional, and polished in every interaction, so that I trust the platform with my time and money.

#### Acceptance Criteria — Design Tokens & Typography

1. THE platform SHALL define a typography scale in CSS variables: `--font-xs` (12px), `--font-sm` (14px), `--font-base` (16px), `--font-lg` (18px), `--font-xl` (22px), `--font-2xl` (28px), `--font-3xl` (34px) with corresponding line-height and letter-spacing tokens.
2. THE platform SHALL define a spacing scale in CSS variables: `--space-1` (4px) through `--space-12` (48px) in a consistent 4px grid system, used across all components for padding, margins, and gaps.
3. THE platform SHALL define gradient tokens: `--gradient-primary` (brand gradient for CTAs and highlights), `--gradient-surface` (subtle card backgrounds), `--gradient-pulse` (activity-based gradient for map elements), all using smooth multi-stop gradients that feel modern and intentional.
4. THE platform SHALL define shadow tokens: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-glow` with consistent blur, spread, and color values that create depth without heaviness.
5. ALL text across all apps SHALL use the defined typography scale — no arbitrary font sizes outside the token system.

#### Acceptance Criteria — Motion & Micro-Interactions

6. ALL bottom sheets SHALL animate in with a spring-based ease (`cubic-bezier(0.32, 0.72, 0, 1)`) over 350ms, and dismiss with a faster 200ms ease-out. Sheets SHALL support swipe-to-dismiss gesture on mobile.
7. ALL buttons SHALL have `active:scale-95` press feedback with a 100ms transition, and primary CTAs SHALL have a subtle gradient shift on hover/press.
8. ALL page/panel transitions SHALL use a shared 250ms fade + 8px translateY entrance animation, staggered by 50ms per element for lists.
9. Toast notifications SHALL slide in from the top with a spring animation, auto-dismiss after 4 seconds with a progress bar, and support swipe-to-dismiss.
10. Card hover/press states SHALL include a subtle lift (translateY -2px + shadow-md) with 150ms transition.
11. THE platform SHALL respect `prefers-reduced-motion` — when enabled, all animations SHALL be replaced with instant state changes (no motion, no scale, no translate).
12. Loading skeletons SHALL use a shimmer animation (gradient sweep left-to-right, 1.5s infinite) on all data-loading states across every screen.

#### Acceptance Criteria — Loading, Empty, and Error States

13. EVERY screen that fetches data SHALL display a skeleton loading state matching the layout of the expected content (not a generic spinner).
14. EVERY screen with potentially empty data SHALL display a purposeful empty state with: an illustration or icon, a headline explaining what goes here, and a CTA to take action (e.g., "No check-ins yet — explore the map").
15. EVERY screen with API calls SHALL display an error state with: an icon, a human-readable message, and a "Try again" button that retries the failed request.
16. ALL loading/empty/error states SHALL use consistent spacing, typography, and alignment from the design token system.

#### Acceptance Criteria — Accessibility

17. ALL interactive elements SHALL have visible focus rings (2px solid with 2px offset, using `--color-focus-ring`) when navigated via keyboard.
18. ALL interactive elements SHALL have `aria-label` or visible text labels for screen readers.
19. ALL color combinations SHALL meet WCAG 2.1 AA contrast ratio (4.5:1 for text, 3:1 for large text and UI components).
20. ALL icon-only buttons SHALL have `aria-label` describing the action.
21. THE platform SHALL support `prefers-color-scheme: dark` with a dark mode that uses the same token system with inverted surface/text values.

#### Acceptance Criteria — Layout & Visual Hierarchy

22. ALL cards SHALL use `rounded-2xl` with consistent internal padding (`--space-4` minimum) and the defined shadow tokens.
23. ALL bottom sheets SHALL use `rounded-t-3xl` with a drag handle indicator (40px wide, 4px tall, centered, `--color-border-subtle`).
24. Dense data screens (Admin dashboard, Billing, Boost ROI) SHALL use clear section headers, adequate whitespace between groups (`--space-6` minimum), and visual separators to prevent cognitive overload.
25. THE NodeDetailSheet SHALL have a clear visual hierarchy: header image → venue name (font-2xl, bold) → category + pulse badge → action buttons (check-in primary, Instagram secondary, directions tertiary) → content sections with consistent spacing.
26. ALL lists SHALL have consistent row height, left-aligned content, and right-aligned metadata/actions.

#### Acceptance Criteria — Haptics & Sound System

27. THE platform SHALL define a sound system with: `success` (short positive chime), `error` (short negative buzz tone), and `notification` (subtle ping) — used consistently across all apps where feedback is needed (not just staff validation).
28. THE platform SHALL trigger haptic feedback on: successful check-in, reward claim, tier change, and button presses on primary CTAs (using `navigator.vibrate` on web, Haptics API on mobile).

#### Acceptance Criteria — Mobile Gesture Polish

29. ALL bottom sheets SHALL support pull-to-dismiss gesture with rubber-band resistance at the top.
30. ALL horizontal lists/carousels SHALL support momentum scrolling with snap points.
31. Pull-to-refresh SHALL be implemented on the map screen, feed screen, and any list that fetches paginated data.

#### Acceptance Criteria — Onboarding & Marketing Readiness

32. THE Onboarding_Flow SHALL include progress dots indicating current step and total steps.
33. THE Onboarding_Flow SHALL use full-bleed illustrations or branded graphics (not raw icons) on each step, with the brand gradient as background.
34. ALL empty states and onboarding screens SHALL use copy that is warm, encouraging, and on-brand — not generic developer placeholder text.
35. THE overall visual quality SHALL be screenshot-ready for marketing materials — clean gradients, intentional whitespace, consistent alignment, and premium typography throughout.

### Requirement 21: Webhook Security & Payment Integrity

**User Story:** As a platform operator, I want Yoco webhooks cryptographically verified and payment lifecycle events properly handled, so that revenue data is accurate and the system is protected from replay attacks and inflated MRR.

#### Acceptance Criteria

1. WHEN a Yoco webhook is received, THE backend SHALL verify the webhook signature using the Yoco webhook secret before processing the event. Requests with invalid or missing signatures SHALL be rejected with HTTP 401.
2. THE backend SHALL enforce a timestamp tolerance of 5 minutes on webhook events — events older than 5 minutes SHALL be rejected as potential replays.
3. WHEN a `payment.failed` event is received, THE backend SHALL record the failure in the payment history (for billing display) and NOT count it toward revenue metrics.
4. WHEN a `refund.succeeded` event is received, THE backend SHALL subtract the refunded amount from the relevant month's revenue aggregation and mark the original payment record with `status: "refunded"`.
5. THE MRR calculation in Req 2 SHALL only include payments with `status: "succeeded"` and SHALL exclude refunded, failed, and disputed payments.
6. WHEN a subscription renewal fails, THE backend SHALL set the business to a 7-day grace period (existing logic) AND record the failed payment event for billing history visibility.

### Requirement 22: Authorization & Tenancy Guards

**User Story:** As a platform operator, I want every API endpoint to enforce resource ownership, so that businesses cannot access other businesses' data and staff cannot operate outside their assigned node.

#### Acceptance Criteria

1. ALL business endpoints (`/v1/business/me/*`) SHALL verify that the authenticated business owns the requested resource (node, reward, boost, billing record) before returning data. Requests for non-owned resources SHALL return HTTP 403.
2. ALL staff endpoints (`/v1/staff/*`) SHALL verify that the authenticated staff member is linked to the business that owns the node being operated on. Staff attempting to validate redemptions for a different business SHALL receive HTTP 403.
3. THE billing history endpoint SHALL only return payment records where `businessId` matches the authenticated business's ID — never cross-tenant data.
4. THE boost ROI endpoint SHALL only return boost history for nodes owned by the authenticated business.
5. THE admin endpoints SHALL verify the admin's role level (super_admin, support_agent, content_moderator) against the action being performed — destructive actions (disable user, disable business) SHALL require super_admin role.
6. ALL authorization failures SHALL be logged with the requesting user ID, attempted resource, and timestamp for security audit purposes.

### Requirement 23: Image Safety & Search Implementation

**User Story:** As a platform operator, I want uploaded images stripped of metadata and search to work reliably within our serverless constraints, so that user privacy is protected and venue discovery is fast.

#### Acceptance Criteria

1. WHEN a business uploads a header image (Req 17), THE backend SHALL strip all EXIF metadata (including GPS coordinates, device info, and timestamps) from the image before storing it in S3.
2. THE image processing SHALL resize the uploaded image to a maximum of 1200px width (maintaining aspect ratio) and compress to WebP format for optimal delivery size.
3. THE venue search (Req 13) SHALL be implemented using client-side filtering: the consumer app SHALL load all nodes for the current city into memory (already done for map rendering) and perform case-insensitive `includes()` matching on node name and category fields.
4. THE search SHALL NOT require a backend search endpoint for basic name/category matching — the existing `GET /v1/nodes` response (already cached client-side for the map) provides sufficient data.
5. IF the node count per city exceeds 500 in the future, THE architecture SHALL support adding a backend `GET /v1/nodes/search?q=&city=` endpoint using DynamoDB `begins_with` on a name-normalized GSI without requiring OpenSearch or any always-on search infrastructure.
6. ALL date-based partition keys (`REVENUE#<YYYY-MM>`, daily metrics, boost windows) SHALL use Africa/Johannesburg timezone (UTC+2) for date boundaries, not UTC.

### Requirement 24: Observability & Structured Logging

**User Story:** As a platform operator, I want structured logs with correlation IDs and CloudWatch alarms on critical failures, so that I can diagnose issues quickly and get alerted before users notice.

#### Acceptance Criteria

1. ALL backend request handlers SHALL include a `requestId` (from API Gateway context) and `correlationId` (generated per request chain) in every log entry, enabling end-to-end request tracing.
2. ALL log entries SHALL be structured JSON with fields: `timestamp`, `level` (info/warn/error), `requestId`, `correlationId`, `service` (feature domain name), `message`, and optional `metadata` object.
3. THE backend SHALL log at `error` level for: unhandled exceptions, DynamoDB failures, Yoco webhook processing failures, Cognito token verification failures, and SQS message processing failures.
4. THE backend SHALL log at `warn` level for: rate limit hits, authorization failures, validation failures, and WebSocket connection drops.
5. THE infrastructure SHALL define CloudWatch alarms for: Lambda error rate exceeding 5% over 5 minutes, SQS dead-letter queue message count > 0, and Yoco webhook handler error rate exceeding 1% over 15 minutes.
6. ALL SQS queues (reward-eval, notification-sender) SHALL have dead-letter queues configured with a `maxReceiveCount` of 3, and DLQ message arrival SHALL trigger a CloudWatch alarm.
7. THE admin dashboard SHALL display a "System Health" indicator showing: Lambda error rate (last hour), DLQ depth, and last successful Yoco webhook timestamp.

### Requirement 25: Shared UI Component Library

**User Story:** As a developer, I want a single source of truth for UI primitives, so that all apps look and behave consistently without duplicating raw Tailwind styles.

#### Acceptance Criteria

1. THE `packages/shared/components/` directory SHALL export the following shared primitives: `Button` (primary, secondary, ghost, danger variants with size options), `Card` (with header, body, footer slots), `Input` (text, password, search, code variants with label, error, and helper text), `Select`, `Badge` (status, tier, pulse-state variants), `Alert` (info, success, warning, error), `MetricCard` (value, label, trend delta, loading skeleton), `DataTable` (sortable columns, pagination, empty state), `Tabs` (horizontal pill style with badge counts), `SheetHeader` (title, subtitle, close button, drag handle), and `ActionRow` (icon + label + chevron for list actions).
2. ALL apps (web, mobile, business, admin, staff) SHALL import and use these shared components instead of duplicating button/card/input/badge styling with raw Tailwind classes.
3. EACH shared component SHALL accept a `className` prop for layout overrides but SHALL NOT allow overriding the component's visual identity (colors, radii, shadows come from tokens only).
4. EACH shared component SHALL include proper TypeScript props interface (no `any`), `aria-*` attributes for accessibility, and loading/disabled states where applicable.
5. THE `Button` component SHALL enforce `active:scale-95` press feedback, disabled state during loading (with spinner), and gradient shift on primary variant hover/press.
6. THE `Badge` component SHALL support pulse-state variants using the correct state names: dormant, quiet, active, buzzing, popping — with corresponding token colors.

### Requirement 26: BottomSheet & NodeDetailSheet Premium Upgrade

**User Story:** As a consumer, I want bottom sheets and the venue detail view to feel native, fluid, and premium, so that every interaction with venue information feels trustworthy and delightful.

#### Acceptance Criteria — BottomSheet Upgrade

1. THE shared `BottomSheet` component SHALL support swipe-to-dismiss gesture with velocity-based threshold (swipe down > 300px/s dismisses, otherwise snaps back with spring animation).
2. THE `BottomSheet` SHALL implement body scroll locking when open (prevent background content from scrolling).
3. THE `BottomSheet` SHALL restore focus to the trigger element on close for keyboard accessibility.
4. THE `BottomSheet` SHALL include `aria-labelledby` pointing to the sheet title and `role="dialog"`.
5. THE `BottomSheet` SHALL play an exit animation (200ms slide-down + fade) before unmounting from the DOM.
6. THE `BottomSheet` SHALL support snap points for tall content (half-screen and full-screen positions) with drag-to-snap behavior.
7. THE `BottomSheet` SHALL include safe-area padding for iOS devices (env(safe-area-inset-bottom)).

#### Acceptance Criteria — NodeDetailSheet Premium Layout

8. THE `NodeDetailSheet` SHALL render in this visual hierarchy from top to bottom: header image (16:9, full-width, rounded-t-3xl) or gradient placeholder → venue name (`--font-2xl`, bold) + category badge + pulse state badge + distance → sticky bottom CTA area containing action buttons → scrollable content sections.
9. THE action button hierarchy SHALL be: Check In (primary, full-width), Instagram (secondary, icon + label), Directions (tertiary, icon + label) — arranged so the primary CTA is always visible without scrolling.
10. THE `NodeDetailSheet` SHALL include a sticky bottom CTA footer that remains visible as content scrolls, ensuring the check-in button never moves out of view.
11. THE rewards section within `NodeDetailSheet` SHALL display skeleton loading states while rewards are being fetched, not an empty space.
12. THE boosted node styling SHALL use tokenized gold variables (`--color-boost-gold`, `--color-boost-glow`) instead of hardcoded `#FFD166`.
13. THE `NodeDetailSheet` SHALL display venue metadata: address (truncated with expand), distance from user, open/closed status (if operating hours are set), and current pulse state with check-in count context (e.g., "42 check-ins today").
14. Report venue and claim venue flows SHALL use the shared `BottomSheet` component, not custom overlay implementations.

### Requirement 27: Search Experience Polish

**User Story:** As a consumer, I want search to feel fast, helpful, and informative before, during, and after typing, so that I can discover venues effortlessly.

#### Acceptance Criteria

1. BEFORE the consumer types, THE search sheet SHALL display recent searches (last 5, stored in local storage) and nearby trending venues (top 3 by pulse score within 2km).
2. WHILE results are loading, THE search sheet SHALL display skeleton rows matching the result layout (not a spinner or "Loading..." text).
3. EACH search result row SHALL display: venue name, category, distance (if location available), pulse state badge (dormant/quiet/active/buzzing/popping), and boosted indicator (gold dot) if the venue has an active boost.
4. IF the search API call fails, THE search sheet SHALL display a retryable error state with message and "Try again" button — NOT silently show "No results found".
5. WHEN a consumer selects a search result, THE app SHALL hydrate the full node record (fetch if not cached) before opening the NodeDetailSheet, ensuring all detail fields are populated.
6. THE search input SHALL include a clear button (×) and support keyboard "Enter" to submit on web.

### Requirement 28: Payment Trust UX

**User Story:** As a business owner spending real money, I want clear confirmation before payment, clear status after payment, and confidence that my billing is transparent, so that I trust the platform with my business finances.

#### Acceptance Criteria

1. BEFORE redirecting to Yoco for any payment (subscription or boost), THE app SHALL display a confirmation summary showing: item description, amount in ZAR, billing frequency (if subscription), and a "Confirm & Pay" button.
2. AFTER returning from Yoco, THE app SHALL display one of three states: success (green, with plan/boost details and activation confirmation), pending (amber, "Payment processing, we'll update you shortly"), or failed (red, with reason and "Try again" button).
3. THE billing history (Req 9) SHALL display status badges using the shared `Badge` component: green for "Paid", red for "Failed", amber for "Pending", grey for "Refunded".
4. WHEN a business changes plans, THE app SHALL show a preview of what changes: new plan name, new amount, effective date, and any prorating information before confirming.
5. WHEN a payment fails and the business enters grace period, THE business dashboard SHALL display a persistent but dismissible banner: "Payment failed — update your payment method within 7 days to keep your plan active" with a link to retry payment.
6. THE boost purchase flow SHALL show a post-purchase confirmation state with: "Boost active!", countdown timer showing remaining boost duration, and a preview of how the boosted marker appears on the map.

### Requirement 29: Business Dashboard Command Center

**User Story:** As a business owner, I want my dashboard to open with a clear overview and guide me through setup, so that I always know what's happening and what to do next.

#### Acceptance Criteria

1. THE BusinessDashboard SHALL open to an overview panel showing: live pulse state, current plan + next billing date, active boost countdown (if any), today's check-in count, today's redemption count, and setup completion percentage.
2. THE dashboard navigation SHALL group the existing 10+ panels into logical sections: Live (live panel, check-in detail), Growth (audience, reports, boost, rewards, reward metrics), Team (staff management, staff redemptions), and Account (billing, plans, settings, node editor).
3. NEW businesses with incomplete setup SHALL see a setup checklist on the overview: create node ✓/✗, add header image ✓/✗, create first reward ✓/✗, invite staff ✓/✗, choose plan ✓/✗ — with each item linking to the relevant panel.
4. THE overview panel SHALL highlight the "next best action" based on setup state: if no node → "Create your venue", if no image → "Add a header photo", if no rewards → "Create your first reward", if on starter plan → "Upgrade to unlock insights".
5. EACH navigation section SHALL show a notification badge count for items needing attention (e.g., pending staff invites, expiring rewards, failed payments).

### Requirement 30: Map Marker Performance Budget

**User Story:** As a consumer on a mid-range phone, I want the map to stay smooth even when many venues are visible, so that the app feels fast regardless of how busy the city is.

#### Acceptance Criteria

1. THE map SHALL limit simultaneous CSS animations (breathing, pulsing, glow transitions) to a maximum of 8 markers in the current viewport. Additional markers SHALL render at their correct size but without animation.
2. MARKERS outside the visible viewport SHALL NOT run animations — animations SHALL start when markers enter the viewport and stop when they leave.
3. WHEN more than 30 markers are visible at the current zoom level, THE map SHALL cluster nearby low-activity markers (pulse score < 11) into a single cluster indicator showing count, while keeping high-activity markers (buzzing/popping) individually visible.
4. ALL marker colors (state colors, boost gold, glow colors) SHALL use CSS variables from the token system — no hardcoded hex values in the marker rendering logic.
5. THE map rendering SHALL respect `prefers-reduced-motion` — when enabled, no marker animations SHALL play, markers SHALL render at their computed static size only.
6. ON devices with `navigator.hardwareConcurrency <= 4` (low-end), THE map SHALL reduce maximum simultaneous animations to 4 and disable glow effects entirely.

### Requirement 31: Verification Gate

**User Story:** As a platform operator, I want proof that all changes pass compilation and tests, so that the sprint does not introduce regressions.

#### Acceptance Criteria

1. AFTER all implementation is complete, `pnpm typecheck` SHALL pass with zero errors across all apps and packages.
2. AFTER all implementation is complete, `pnpm test` SHALL pass with zero test failures.
3. AFTER all implementation is complete, `pnpm --filter @area-code/web build` SHALL succeed.
4. AFTER all implementation is complete, `pnpm --filter @area-code/business build` SHALL succeed.
5. AFTER all implementation is complete, `pnpm --filter @area-code/admin build` SHALL succeed.
6. AFTER all implementation is complete, `pnpm --filter @area-code/staff build` SHALL succeed.
7. IF any verification step fails, THE implementation SHALL fix the failure and re-run verification until all checks pass.
