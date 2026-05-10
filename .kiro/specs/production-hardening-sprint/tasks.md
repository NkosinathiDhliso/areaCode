# Implementation Plan: Production Hardening Sprint

## Overview

This plan implements 31 requirements for the Area Code platform production hardening sprint. All work uses TypeScript across the monorepo (Fastify 5 backend on Lambda, React 18 frontends with Vite/Tailwind/Zustand). The execution order follows the dependency chain: foundational infrastructure first (discovery sweep, shared components, error handling, observability), then security/auth, then revenue/billing, then feature work, and finally polish/verification.

## Tasks

- [x] 1. Discovery Sweep — Code Quality Audit and Inline Fixes
  - [x] 1.1 Scan all backend files for security vulnerabilities, broken imports, unhandled promise rejections, raw `throw new Error()` statements, `ScanCommand` usage, and hardcoded secrets — fix each issue inline as discovered
    - Replace all `ScanCommand` with `QueryCommand` using appropriate indexes
    - Replace all raw `throw new Error()` with `AppError` class usage
    - Add `.catch()` or try/catch to all unhandled promises in WebSocket handlers, SQS processors, and notification functions
    - Move any hardcoded secrets to environment variables
    - _Requirements: 16.6, 16.7, 16.11, 11.3, 11.4, 11.5_
  - [x] 1.2 Scan all frontend files for TypeScript errors, `any` types in props, inline business logic, mock/placeholder data, missing useEffect cleanup, and hardcoded colors — fix each issue inline
    - Remove all `any` type annotations from component props and function parameters
    - Extract inline business logic to hooks or service functions
    - Delete mock/placeholder data from production code paths
    - Add cleanup functions to all useEffect hooks with subscriptions/timers
    - Replace hardcoded hex/rgb values with CSS variables
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.8, 16.10_
  - [x] 1.3 Split any files exceeding 300 lines into smaller modules and disable interactive buttons during pending API calls
    - Split oversized files maintaining handler → service → repository → DB pattern
    - Add loading/disabled state to all buttons that trigger API calls
    - _Requirements: 16.2, 16.9_

- [x] 2. Checkpoint — Discovery sweep complete
  - Ensure TypeScript compiles cleanly (`pnpm typecheck`), ask the user if questions arise.

- [ ] 3. Shared UI Component Library
  - [x] 3.1 Create `packages/shared/components/Button.tsx` with primary, secondary, ghost, danger variants, size options, loading spinner, disabled state, and `active:scale-95` press feedback
    - TypeScript props interface (no `any`), `aria-*` attributes, `className` prop for layout overrides only
    - Gradient shift on primary variant hover/press
    - _Requirements: 25.1, 25.3, 25.4, 25.5_
  - [x] 3.2 Create `packages/shared/components/Card.tsx` with header, body, footer slots using `rounded-2xl`, token shadows, and consistent internal padding
    - _Requirements: 25.1, 25.3, 20.22_
  - [x] 3.3 Create `packages/shared/components/Input.tsx` (text, password, search, code variants) with label, error, helper text, and `packages/shared/components/Select.tsx`
    - _Requirements: 25.1, 25.4_
  - [x] 3.4 Create `packages/shared/components/Badge.tsx` with status, tier, and pulse-state variants (dormant, quiet, active, buzzing, popping) using token colors
    - _Requirements: 25.1, 25.6_
  - [x] 3.5 Create `packages/shared/components/Alert.tsx` (info, success, warning, error), `MetricCard.tsx` (value, label, trend, loading skeleton), and `DataTable.tsx` (sortable columns, pagination, empty state)
    - _Requirements: 25.1, 25.4_
  - [x] 3.6 Create `packages/shared/components/Tabs.tsx` (horizontal pill with badge counts), `SheetHeader.tsx` (title, subtitle, close, drag handle), and `ActionRow.tsx` (icon + label + chevron)
    - _Requirements: 25.1, 25.4_
  - [x] 3.7 Create design token CSS variables file: typography scale, spacing scale (4px grid), gradient tokens, shadow tokens, and export from shared package
    - Define `--font-xs` through `--font-3xl`, `--space-1` through `--space-12`, `--gradient-primary/surface/pulse`, `--shadow-sm/md/lg/glow`
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

- [x] 4. Error Handling and Resilience Layer
  - [x] 4.1 Add Zod schema validation to all backend route handlers for request body, query params, and path params
    - Return 400 with field-level error details (no internal schema exposure)
    - _Requirements: 11.1, 11.8_
  - [x] 4.2 Apply rate limiting middleware to all public API endpoints (not just check-in) and configure CORS to allow only defined frontend origins
    - Return 429 with `Retry-After` header on rate limit hits
    - _Requirements: 11.2, 11.6_
  - [x] 4.3 Apply helmet security headers to all HTTP responses and ensure structured error responses (error code, message, requestId) with no stack trace exposure
    - _Requirements: 11.7, 11.8_
  - [x] 4.4 Write property test for structured error response format
    - **Property 22: Structured Error Response**
    - **Validates: Requirements 11.8**

- [x] 5. Observability and Structured Logging
  - [x] 5.1 Implement `StructuredLogger` utility at `backend/src/shared/monitoring/logger.ts` with JSON output, requestId, correlationId, service name, and child logger factory
    - _Requirements: 24.1, 24.2_
  - [x] 5.2 Integrate structured logger into all request handlers — log errors for unhandled exceptions/DDB failures/webhook failures/Cognito failures/SQS failures, log warnings for rate limits/auth failures/validation failures/WS drops
    - _Requirements: 24.3, 24.4_
  - [x] 5.3 Define CloudWatch alarms in infrastructure: Lambda error rate > 5% (5min), DLQ depth > 0, Yoco webhook error rate > 1% (15min). Configure DLQ on all SQS queues with maxReceiveCount=3
    - _Requirements: 24.5, 24.6_
  - [x] 5.4 Add "System Health" indicator to admin dashboard showing Lambda error rate, DLQ depth, and last successful Yoco webhook timestamp
    - _Requirements: 24.7_

- [x] 6. Webhook Security and Payment Integrity
  - [x] 6.1 Implement Yoco webhook HMAC signature verification and 5-minute timestamp tolerance check in the webhook handler — reject invalid/stale requests with 401
    - _Requirements: 21.1, 21.2_
  - [x] 6.2 Handle `payment.failed` events (record failure in payment history, exclude from revenue) and `refund.succeeded` events (subtract from revenue, mark original as refunded)
    - _Requirements: 21.3, 21.4, 21.5_
  - [x] 6.3 Handle subscription renewal failures — set 7-day grace period and record failed payment event for billing visibility
    - _Requirements: 21.6_
  - [x] 6.4 Write property test for webhook signature verification
    - **Property 14: Webhook Signature Verification**
    - **Validates: Requirements 21.1, 21.2**

- [x] 7. Authorization and Tenancy Guards
  - [x] 7.1 Add ownership verification middleware to all business endpoints — verify `resource.businessId === authenticatedBusiness.id` before returning data, return 403 on violation
    - _Requirements: 22.1, 22.3, 22.4_
  - [x] 7.2 Add staff-to-business linkage verification on all staff endpoints — verify staff member's businessId matches the node's businessId, return 403 on violation
    - _Requirements: 22.2_
  - [x] 7.3 Add admin role-level authorization — verify role hierarchy (super_admin > support_agent > content_moderator) for destructive actions. Log all authorization failures with userId, resource, timestamp
    - _Requirements: 22.5, 22.6_
  - [x] 7.4 Write property tests for resource ownership and admin role authorization
    - **Property 15: Resource Ownership Enforcement**
    - **Property 16: Admin Role Authorization**
    - **Validates: Requirements 22.1, 22.2, 22.3, 22.4, 22.5**

- [x] 8. Checkpoint — Infrastructure layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. WebSocket Health and Reconnection
  - [x] 9.1 Implement client-side WebSocket reconnection with exponential backoff (1s initial, 30s max, with jitter) across all apps
    - _Requirements: 12.1_
  - [x] 9.2 Implement server-side stale connection cleanup — detect connections without heartbeat within 60 seconds and remove from DynamoDB ws-connections table
    - _Requirements: 12.2_
  - [x] 9.3 Create `GET /v1/health/websocket` endpoint returning active connection count, connections by room type, and uptime
    - _Requirements: 12.3_
  - [x] 9.4 Add "Active WebSocket Connections" metric card to admin dashboard using the health endpoint
    - _Requirements: 12.4_
  - [x] 9.5 Write property test for exponential backoff calculation
    - **Property 9: Exponential Backoff Calculation**
    - **Validates: Requirements 12.1**

- [ ] 10. Revenue Payment Storage
  - [x] 10.1 Implement `PaymentService.processPaymentEvent` — store payment record with dual-key pattern (pk=`PAYMENT#<businessId>`, sk=`<timestamp>#<paymentId>`, gsi1pk=`REVENUE#<YYYY-MM>` using SAST timezone, gsi1sk=`<timestamp>#<paymentId>`)
    - Include all required fields: amount (ZAR cents), type, planTier, businessId, nodeId, status, paymentProvider="yoco", currency="ZAR"
    - Use `ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'` for idempotency
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 10.2 Write property tests for payment record completeness, idempotency, and timezone partition key correctness
    - **Property 1: Payment Record Completeness and Idempotency**
    - **Property 18: Timezone Partition Key Correctness**
    - **Validates: Requirements 1.1, 1.3, 1.4, 23.6**

- [ ] 11. Admin Revenue Dashboard
  - [x] 11.1 Implement `RevenueService` with methods: `getMRR()`, `getBoostRevenue(start, end)`, `getSubscriptionCounts()`, `getTrialConversionRate()`, `getFlexDailyRevenue(start, end)`, `getPerBusinessBreakdown(start, end)` — all querying via `REVENUE#<YYYY-MM>` partition key, never table scan
    - MRR = sum of succeeded subscription payments normalized to monthly
    - Trial conversion = businesses upgraded from starter within 30 days / total starter businesses
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_
  - [x] 11.2 Create `GET /v1/admin/revenue` and `GET /v1/admin/revenue/breakdown` endpoints with date range filters (today, this week, this month, custom)
    - _Requirements: 2.6, 2.7_
  - [x] 11.3 Build Admin Revenue Dashboard UI with MetricCard components for MRR, boost revenue, subscription counts by tier, trial conversion rate, PAYG/Flex Daily revenue, and per-business breakdown DataTable
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 11.4 Write property tests for revenue aggregation correctness, filtering/grouping, and trial conversion
    - **Property 2: Revenue Aggregation Correctness**
    - **Property 3: Revenue Query Filtering and Grouping**
    - **Property 4: Trial Conversion Rate Computation**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7**

- [ ] 12. Business Billing History
  - [x] 12.1 Create `GET /v1/business/me/billing` endpoint — paginated (20 per page), sorted by date descending, querying `PAYMENT#<businessId>` partition key with ownership verification
    - _Requirements: 9.2, 9.3, 22.3_
  - [x] 12.2 Build Billing Panel UI in BusinessDashboard with payment history table (date, description, amount in ZAR, status badge), current plan name, next billing date, and "Billing" tab navigation
    - Use shared DataTable, Badge, and Tabs components
    - _Requirements: 9.1, 9.3, 9.4_
  - [x] 12.3 Write property test for billing pagination and sorting
    - **Property 12: Billing Pagination and Sorting**
    - **Validates: Requirements 9.2**

- [ ] 13. Payment Trust UX
  - [x] 13.1 Build pre-payment confirmation summary (item description, amount in ZAR, billing frequency, "Confirm & Pay" button) shown before Yoco redirect for both subscriptions and boosts
    - _Requirements: 28.1_
  - [x] 13.2 Build post-payment return states: success (green, plan/boost details), pending (amber, processing message), failed (red, reason + "Try again")
    - _Requirements: 28.2_
  - [x] 13.3 Add plan change preview (new plan, new amount, effective date, prorating info), grace period banner for failed payments, and boost purchase confirmation with countdown timer
    - _Requirements: 28.4, 28.5, 28.6_
  - [x] 13.4 Apply status badges in billing history using shared Badge component (green=Paid, red=Failed, amber=Pending, grey=Refunded)
    - _Requirements: 28.3_

- [ ] 14. Checkpoint — Revenue and billing complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Staff App — Live Queue, Validation, and Store
  - [x] 15.1 Implement Staff Zustand store (`packages/shared/stores/staffStore.ts`) managing liveQueue (max 20), recentRedemptions (max 50), todayStats, wsStatus, with actions for addCheckIn, addRedemption, updateStats, setWsStatus, reset
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 15.2 Implement staff WebSocket connection — join business room, subscribe to `staff:checkin`, `staff:redemption`, `staff:stats_update` events, update store on each event, handle disconnection with exponential backoff
    - _Requirements: 4.1, 4.2, 6.3_
  - [x] 15.3 Build Staff Live Queue UI — display incoming check-in cards (consumer name, tier badge, timestamp) within 2 seconds, "Today's Stats" bar (check-ins, redemptions, pulse state)
    - _Requirements: 4.2, 4.3, 4.4_
  - [x] 15.4 Build Staff Reward Validation — QR scanner (rear camera), manual 32-char hex input fallback, preview card (reward title, type, description, consumer name, tier), success/error feedback with sound and haptics
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 15.5 Build Recent Redemptions list (last 50, filterable by status) with code, reward title, timestamp, and status
    - _Requirements: 5.6_
  - [x] 15.6 Write property tests for staff queue bounds/ordering and redemption code validation
    - **Property 7: Staff Queue Bounds and Ordering**
    - **Property 8: Redemption Code Validation**
    - **Validates: Requirements 4.3, 5.2, 5.6**

- [ ] 16. Dynamic Map Markers and Performance Budget
  - [x] 16.1 Implement marker radius computation: `8 + (Math.min(pulseScore / 200, 1) * 20)` px, boost floor of 18px, touch target always >= 44px, glow intensity = `Math.min(pulseScore / 200, 1)`
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - [x] 16.2 Implement marker animations: gold ring + pulsing for boosted nodes, breathing scale (1.0→1.15, 2s) for popping state, z-ordering by pulse score (higher score = higher z-index)
    - All marker colors via CSS variables from token system
    - _Requirements: 3.3, 3.4, 3.6, 30.4_
  - [x] 16.3 Implement animation budget system: max 8 simultaneous animations in viewport (4 on low-end devices with hardwareConcurrency <= 4), assign to highest pulse score markers, stop animations outside viewport, respect `prefers-reduced-motion`
    - _Requirements: 30.1, 30.2, 30.5, 30.6_
  - [x] 16.4 Implement marker clustering: when > 30 markers visible, cluster low-activity markers (pulse < 11) into count indicators, keep active/buzzing/popping individually visible
    - _Requirements: 30.3_
  - [x] 16.5 Write property tests for marker rendering invariants, z-ordering, animation budget, and clustering
    - **Property 5: Marker Rendering Invariants**
    - **Property 6: Marker Z-Ordering**
    - **Property 19: Animation Budget Enforcement**
    - **Property 20: Map Clustering Logic**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 30.1, 30.2, 30.3, 30.5, 30.6**

- [ ] 17. BottomSheet and NodeDetailSheet Premium Upgrade
  - [x] 17.1 Upgrade shared `BottomSheet` component: swipe-to-dismiss (velocity > 300px/s), body scroll lock, focus restoration, `aria-labelledby` + `role="dialog"`, exit animation (200ms slide-down + fade), snap points (half/full screen), iOS safe-area padding
    - Spring-based ease (`cubic-bezier(0.32, 0.72, 0, 1)`) over 350ms open, 200ms close
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7, 20.6_
  - [x] 17.2 Rebuild `NodeDetailSheet` with premium layout: header image (16:9, rounded-t-3xl) or gradient placeholder → venue name (font-2xl) + category + pulse badge + distance → sticky bottom CTA (Check In primary, Instagram secondary, Directions tertiary) → scrollable content
    - Skeleton loading for rewards section, tokenized boost gold colors, venue metadata (address, distance, open/closed, pulse context)
    - _Requirements: 26.8, 26.9, 26.10, 26.11, 26.12, 26.13, 26.14_

- [ ] 18. Boost ROI Panel
  - [x] 18.1 Implement boost ROI service: compute baseline (avg check-ins same window, prior 4 weeks), compute uplift `((boost_checkins - baseline) / baseline) * 100`, handle insufficient data (< 2 weeks)
    - _Requirements: 8.2, 8.3, 8.4_
  - [x] 18.2 Create `GET /v1/business/me/boosts/roi` endpoint with ownership verification and build Boost ROI Panel UI showing past boosts with date, duration, check-ins, uplift %, and cost in ZAR
    - _Requirements: 8.1, 22.4_
  - [x] 18.3 Write property test for boost ROI computation
    - **Property 11: Boost ROI Computation**
    - **Validates: Requirements 8.2, 8.3, 8.4**

- [ ] 19. Proximity Notifications (Client-Side)
  - [x] 19.1 Implement `ProximityModule` at `packages/shared/lib/proximity.ts`: haversine distance calculation, filter nodes within 500m with buzzing/popping state, 15-minute debounce per node in client storage, opt-in check
    - No GPS sent to backend — uses cached node data from map
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 19.2 Integrate proximity module with geolocation updates in consumer app and trigger web push notifications via Service Worker when app is in background
    - _Requirements: 7.5_
  - [x] 19.3 Write property test for proximity notification trigger logic
    - **Property 10: Proximity Notification Trigger**
    - **Validates: Requirements 7.2, 7.3, 7.4**

- [ ] 20. Checkpoint — Core features complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 21. PAYG Rename to Flex Daily
  - [x] 21.1 Update PlansPanel display: rename "Pay As You Go" to "Flex Daily", update description to "Low daily rate, no commitment", use `flex_daily` identifier in new code while maintaining backward compatibility with existing "payg" data
    - Update SALES_PITCH.md documentation
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 22. Search, Image Safety, and Search Polish
  - [x] 22.1 Implement client-side search filtering: case-insensitive `includes()` on node name and category from cached map data, sort by haversine distance when location available, return within 500ms
    - _Requirements: 13.1, 13.2, 13.4, 23.3, 23.4_
  - [x] 22.2 Build search UI: recent searches (last 5 from localStorage), nearby trending (top 3 by pulse within 2km), skeleton loading rows, result rows with name/category/distance/pulse badge/boost indicator, empty state, error state with retry, clear button + Enter support
    - _Requirements: 13.3, 13.5, 27.1, 27.2, 27.3, 27.4, 27.5, 27.6_
  - [x] 22.3 Implement image processing: strip all EXIF metadata, resize to max 1200px width (maintain aspect ratio), compress to WebP format — run on upload via Lambda
    - _Requirements: 23.1, 23.2_
  - [x] 22.4 Write property tests for search filtering/sorting and image processing invariants
    - **Property 13: Client-Side Search Filtering and Sorting**
    - **Property 17: Image Processing Invariants**
    - **Validates: Requirements 13.1, 13.2, 23.1, 23.2**

- [ ] 23. Business Node Header Image Upload
  - [x] 23.1 Create `POST /v1/business/nodes/:nodeId/image/upload-url` endpoint (presigned S3 PUT URL scoped to nodeId, JPEG/PNG, max 2MB) and `DELETE /v1/business/nodes/:nodeId/image` endpoint
    - Store `headerImageKey` on node record, replace existing image on re-upload (delete old S3 object)
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [x] 23.2 Build image upload control in NodeEditorPanel and display header image in NodeDetailSheet (full-width banner, 16:9, object-fit cover, rounded-t-3xl) with gradient placeholder fallback
    - _Requirements: 17.1, 17.5, 17.6_

- [ ] 24. Instagram Handle Integration
  - [x] 24.1 Add Instagram handle input to NodeEditorPanel (@ prefix, alphanumeric + underscores + periods, max 30 chars), create `PUT /v1/business/nodes/:nodeId/instagram` endpoint storing handle without @ prefix
    - _Requirements: 18.1, 18.2_
  - [x] 24.2 Display Instagram button in NodeDetailSheet (below check-in) when handle exists, open `https://instagram.com/<handle>` on tap, hide button when no handle set
    - _Requirements: 18.3, 18.4, 18.5_
  - [x] 24.3 Write property test for Instagram handle validation
    - **Property 21: Instagram Handle Validation**
    - **Validates: Requirements 18.1, 18.2**

- [ ] 25. Directions App Chooser
  - [x] 25.1 Build directions chooser bottom sheet/action menu: list Google Maps, Waze, Apple Maps (iOS only), construct correct deep link URLs using node lat/lng, remember last-used preference in localStorage, open directly if only one app available
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [ ] 26. Business Dashboard Command Center
  - [x] 26.1 Build overview panel: live pulse state, current plan + next billing date, active boost countdown, today's check-ins, today's redemptions, setup completion percentage
    - _Requirements: 29.1_
  - [x] 26.2 Reorganize dashboard navigation into sections: Live, Growth, Team, Account — with notification badge counts for items needing attention
    - _Requirements: 29.2, 29.5_
  - [x] 26.3 Build setup checklist for new businesses (create node, add image, create reward, invite staff, choose plan) with "next best action" highlight linking to relevant panels
    - _Requirements: 29.3, 29.4_

- [ ] 27. Checkpoint — Feature work complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 28. Onboarding Flow
  - [x] 28.1 Build onboarding screens: location permission (with explanation + "Grant Access"), notification priming ("Enable"/"Skip"), music connection ("Connect"/"Skip"), first check-in tutorial ("Got it")
    - Progress dots, full-bleed illustrations with brand gradient background, warm on-brand copy
    - Mark profile as onboarded on completion, don't show again
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 20.32, 20.33, 20.34_

- [ ] 29. Internationalization Completeness
  - [x] 29.1 Wrap all user-facing strings across all apps in `t()` translation function calls: UI labels, error messages, toast notifications, empty states, form validation messages
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [ ] 30. UX Polish Pass
  - [x] 30.1 Apply motion system: spring-based bottom sheet animations, `active:scale-95` on all buttons, page/panel transitions (250ms fade + 8px translateY, 50ms stagger), toast slide-in with progress bar and swipe-to-dismiss, card hover/press lift
    - Respect `prefers-reduced-motion` — replace all animations with instant state changes
    - _Requirements: 20.6, 20.7, 20.8, 20.9, 20.10, 20.11_
  - [x] 30.2 Apply loading skeleton shimmer animation (gradient sweep, 1.5s infinite) to all data-loading states, purposeful empty states (icon + headline + CTA) on all screens, and error states (icon + message + "Try again") on all API screens
    - _Requirements: 20.12, 20.13, 20.14, 20.15, 20.16_
  - [x] 30.3 Apply accessibility: visible focus rings (2px solid, 2px offset), `aria-label` on all interactive elements, WCAG AA contrast (4.5:1 text, 3:1 UI), `aria-label` on icon-only buttons, dark mode support using token system
    - _Requirements: 20.17, 20.18, 20.19, 20.20, 20.21_
  - [x] 30.4 Apply layout polish: consistent card styling (rounded-2xl, space-4 padding, token shadows), bottom sheet drag handles (40px × 4px centered), section headers and whitespace on dense screens, NodeDetailSheet visual hierarchy, consistent list row heights
    - _Requirements: 20.22, 20.23, 20.24, 20.25, 20.26_
  - [x] 30.5 Apply haptics and sound system (success chime, error buzz, notification ping), haptic feedback on check-in/reward claim/tier change/primary CTAs, pull-to-dismiss on sheets, momentum scrolling with snap points, pull-to-refresh on map/feed/lists
    - _Requirements: 20.27, 20.28, 20.29, 20.30, 20.31_
  - [x] 30.6 Ensure all text uses typography scale tokens (no arbitrary font sizes), all spacing uses the 4px grid system, and overall visual quality is screenshot-ready for marketing
    - _Requirements: 20.1, 20.2, 20.5, 20.35_

- [ ] 31. Checkpoint — Polish complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 32. Verification Gate
  - [x] 32.1 Run `pnpm typecheck` — fix any TypeScript compilation errors across all apps and packages until zero errors
    - _Requirements: 31.1_
  - [x] 32.2 Run `pnpm test` — fix any test failures until zero failures
    - _Requirements: 31.2_
  - [x] 32.3 Run builds for all apps: `pnpm --filter @area-code/web build`, `pnpm --filter @area-code/business build`, `pnpm --filter @area-code/admin build`, `pnpm --filter @area-code/staff build` — fix any build failures
    - _Requirements: 31.3, 31.4, 31.5, 31.6_
  - [x] 32.4 Re-run verification if any step failed — iterate until all checks pass
    - _Requirements: 31.7_

## Notes

- Tasks marked with `*` are optional property-based test tasks and can be skipped for faster MVP
- Each task references specific requirement clauses for traceability
- Checkpoints ensure incremental validation between major phases
- All monetary values stored as integer ZAR cents, displayed with `toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })`
- All date partition keys use Africa/Johannesburg timezone (UTC+2)
- Property tests use `fast-check` library with Vitest, minimum 100 iterations per property
- The discovery sweep (Task 1) fixes issues inline as found — not a two-phase audit
- All new code follows handler → service → repository → DB pattern in backend
- All frontend components use shared UI library — no duplicating raw Tailwind styles
- File limit: 300 lines warning, 400 hard limit — split as needed
