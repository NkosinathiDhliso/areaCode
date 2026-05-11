# Implementation Plan: Venue Live Signals

## Overview

This plan implements the Waze-style crowd-sourced venue signal system. The approach is incremental: first the backend signal infrastructure (types, aggregator, repository, routes), then the delta polling endpoint, then the consumer app UI (polling hook, signal display, submission UI), then owner/dispute flows, and finally admin moderation. Each step builds on the previous and integrates immediately — no orphaned code.

## Tasks

- [x] 1. Signal types, validation schemas, and aggregator core
  - [x] 1.1 Create signal types and Zod validation schemas
    - Create `backend/src/features/signals/types.ts`
    - Define `SignalRecord`, `ConsensusResult`, `SubmitSignalInput`, `SubmitSignalResult`, `DisputeRecord` interfaces
    - Define `MusicGenre` enum/union with 12 SA genres (amapiano, deep_house, afrobeats, hip_hop, rnb, kwaito, gqom, jazz, rock, pop, gospel, maskandi)
    - Define `QueueValue` union: `none | short | long`
    - Define `SignalType` union: `genre_playing | queue_length`
    - Create Zod schemas for signal submission validation (type + value cross-validation)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.2 Write property test for signal value validation (Property 2)
    - **Property 2: Signal Value Validation**
    - Test that genre_playing accepts only the 12 MusicGenre values and rejects all others
    - Test that queue_length accepts only none/short/long and rejects all others
    - Use fast-check string arbitraries and valid/invalid value generators
    - **Validates: Requirements 2.2, 2.3**

  - [x] 1.3 Implement confidence scoring and decay functions
    - Create `backend/src/features/signals/aggregator.ts`
    - Implement `computeConfidence(signal, now)` — recency decay, proximity multiplier (1.5x), tier weight, owner weight
    - Implement decay function: genre signals reach zero at 60 min, queue signals at 30 min
    - Implement `getReporterWeight(tier)` — legend=2.0, institution=1.8, fixture=1.5, regular=1.2, local=1.0
    - All functions must be pure (no side effects, no DB calls)
    - _Requirements: 5.1, 5.2, 5.3, 10.1_

  - [x] 1.4 Write property tests for confidence scoring (Properties 4, 5, 12)
    - **Property 4: Confidence Score Bounds and Monotonicity**
    - Verify score always between 0.0 and 1.0, more recent signals score higher, proximity signals score higher
    - **Property 5: Decay Function TTL Enforcement**
    - Verify genre signals decay to zero at 60 min, queue at 30 min, positive before TTL
    - **Property 12: Tier-to-Weight Mapping**
    - Verify all 5 tier values map to correct weights
    - **Validates: Requirements 5.1, 5.2, 5.3, 10.1**

  - [x] 1.5 Implement consensus computation
    - Add `computeConsensus(signals, type, now)` to aggregator
    - Select value with highest aggregate weighted score as consensus
    - Return null consensus when highest score < 0.15 (V1 threshold; Phase 2 raises to 0.3)
    - Enforce single-user confidence cap (never >= 0.7 from one user alone)
    - _Requirements: 5.4, 5.5, 5.6, 10.6_

  - [x] 1.6 Write property tests for consensus (Properties 6, 13)
    - **Property 6: Consensus Selection Correctness**
    - Verify highest aggregate score wins, null when below 0.3
    - **Property 13: Single-User Confidence Cap**
    - Verify single-user signals never reach 0.7 confidence
    - **Validates: Requirements 5.4, 5.5, 10.6**

- [~] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Signal repository and service layer
  - [x] 3.1 Implement signal repository
    - Create `backend/src/features/signals/repository.ts`
    - Implement `storeSignal(signal)` — PutItem to `app-data` DynamoDB table (via `documentClient` from `backend/src/shared/db/dynamodb.ts`) with pk=SIGNAL#nodeId, sk=ts#userId, TTL=24h
    - Implement `getSignalsForNode(nodeId, type, since)` — Query with ScanIndexForward=false
    - Implement `storeDispute(dispute)` — PutItem to `app-data` with pk=DISPUTE#nodeId
    - Implement `getDisputesForBusiness(businessId, since)` — Query
    - Implement `updateSignalConfidence(signalId, nodeId, multiplier)` — UpdateItem on disputeMultiplier
    - Import `documentClient` and `TableNames` from `backend/src/shared/db/dynamodb.ts`
    - _Requirements: 2.7, 8.3, 12.1_

  - [x] 3.2 Implement rate limiting and daily cap helpers
    - Implement per-type/node/user 5-minute rate limit using existing `kvIncr` from `backend/src/shared/kv/dynamodb-kv.ts` (key=`signal-rate:<userId>:<nodeId>:<type>`, TTL=300s)
    - Implement 2-minute correction window using `kvSet` (key=`signal-correction:<userId>:<nodeId>:<type>`, TTL=120s) — stores reference to the overwritable signal sort key
    - Implement daily 50-signal cap using `kvIncr` (key=`signal-daily:<userId>:<YYYY-MM-DD>`, TTL=86400s)
    - Implement owner 30-minute rate limit per type per node using `kvIncr`
    - Implement dispute 5/day limit per business using `kvIncr`
    - _Requirements: 2.9, 2.10, 7.5, 8.5, 10.4_

  - [x] 3.3 Implement proximity classification
    - Add `classifyProximity(userLat, userLng, nodeLat, nodeLng)` to service
    - Use haversine formula, threshold = 150 metres
    - Return `Proximity_Report` if <= 150m, `Remote_Report` if > 150m or no coords
    - _Requirements: 2.5, 2.6_

  - [x] 3.4 Write property test for proximity classification (Property 3)
    - **Property 3: Proximity Classification**
    - Test haversine distance <= 150m → Proximity_Report, > 150m → Remote_Report, no coords → Remote_Report
    - Use fast-check coordinate pair generators at varying distances
    - **Validates: Requirements 2.5, 2.6**

  - [x] 3.5 Implement signal service orchestration
    - Create `backend/src/features/signals/service.ts`
    - Implement `submitSignal(input)` — validate, check rate limit (or correction window), check daily cap, classify proximity, store signal (or overwrite if correction), query recent signals, compute consensus, update node record, increment reputation
    - Implement `correctSignal(input)` — within 2-minute window, overwrite previous signal for same type/node instead of creating new record; no additional reputation awarded for corrections
    - Implement `calculateReputation(isProximity)` — 2 points for proximity, 1 for remote
    - Implement `detectContradiction(newSignal, existingSignals)` — flag if 3+ different-user reports agree on different value
    - Implement `applyPenalty(userId, currentWeight)` — reduce by 0.2, min 0.1 (V1 soft-ban floor; Phase 2 reduces to 0.0)
    - Implement `disputeSignal(signalId, businessId, reason)` — verify ownership, store dispute, reduce confidence by 50%
    - _Requirements: 2.4, 2.8, 2.9, 2.10, 5.6, 5.7, 6.1, 6.2, 7.1, 8.2, 8.4, 10.2, 10.3_

  - [x] 3.6 Write property tests for reputation and dispute logic (Properties 7, 9, 10, 11, 15)
    - **Property 7: Reputation Increment Correctness**
    - Verify proximity → +2, remote → +1, independent of type/value/node
    - **Property 9: Dispute Ownership Verification**
    - Verify only owning business can dispute
    - **Property 10: Dispute Confidence Round-Trip**
    - Verify dispute halves weight, dismiss restores it
    - **Property 11: Reporter Weight Penalty**
    - Verify penalty reduces by 0.1, never below 0.0
    - **Property 15: Contradiction Detection**
    - Verify 3+ agreeing different-user reports trigger flag, fewer do not
    - **Validates: Requirements 6.1, 6.2, 8.2, 8.4, 9.3, 9.4, 10.2, 10.3**

- [x] 4. Signal API routes and owner report handling
  - [x] 4.1 Implement signal Fastify route handlers
    - Create `backend/src/features/signals/handler.ts`
    - Register routes in Fastify app
    - `POST /v1/signals` — auth middleware (consumer Cognito), validate body with Zod schema, call submitSignal service, return 201 with signalId + reputationEarned
    - `GET /v1/signals/:nodeId` — return active signals with consensus for a node
    - `POST /v1/signals/:signalId/dispute` — auth middleware (business Cognito), validate reason length <= 500, call disputeSignal service
    - Implement all error responses per design (401, 400, 403, 404, 429)
    - _Requirements: 2.1, 2.4, 7.4, 8.1, 8.2_

  - [x] 4.2 Implement owner report tagging and weight
    - In submitSignal flow, detect if authenticated user is business owner of the node
    - Tag signal as Owner_Report (isOwner=true)
    - Apply fixture-tier (1.5) proximity weight to owner reports regardless of actual tier
    - _Requirements: 7.1, 7.2_

  - [x] 4.3 Write property test for owner report weight (Property 8)
    - **Property 8: Owner Report Tagging and Weight**
    - Verify owner reports receive same effective weight as fixture-tier proximity report (1.5 × 1.5)
    - **Validates: Requirements 7.1, 7.2**

- [~] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Delta polling endpoint and GSI
  - [x] 6.1 Add CityUpdatedIndex GSI to nodes DynamoDB table
    - Update `infra/environments/dev/main.tf` and `infra/environments/prod/main.tf` — add `cityId` (S) and `signalUpdatedAt` (S) attributes to the existing `aws_dynamodb_table.nodes` resource
    - Add GSI `CityUpdatedIndex` with hash_key=`cityId`, range_key=`signalUpdatedAt`, projection_type="ALL"
    - Billing mode is already PAY_PER_REQUEST (no provisioned capacity needed)
    - _Requirements: 1.4, 1.6, 12.4_

  - [x] 6.2 Implement delta polling endpoint
    - Create `backend/src/features/nodes/delta-handler.ts`
    - `GET /v1/pulse/city/:slug/delta?since=<ISO timestamp>`
    - Query CityUpdatedIndex GSI on the DynamoDB `nodes` table where cityId=city AND signalUpdatedAt > since
    - Return DeltaResponse with changed nodes and serverTime
    - Validate city slug exists, validate since is valid ISO timestamp
    - Target < 500ms response for up to 500 active nodes
    - Include all error responses per design (400, 404)
    - Import `documentClient` and `TableNames` from `backend/src/shared/db/dynamodb.ts`
    - _Requirements: 1.4, 1.5, 1.6, 12.4_

  - [x] 6.3 Write property test for delta response completeness (Property 1)
    - **Property 1: Delta Response Completeness and Precision**
    - Verify exactly nodes with signalUpdatedAt > since are returned, none with <= since
    - Use fast-check arrays of node records with random timestamps and random since values
    - **Validates: Requirements 1.6, 12.4**

- [x] 7. Consumer app polling hook and WebSocket removal
  - [x] 7.1 Create useDeltaPoll hook
    - Create `packages/shared/hooks/useDeltaPoll.ts`
    - Poll `GET /v1/pulse/city/:slug/delta?since=<serverTime>` every 10 seconds
    - Track serverTime from last response as next since value
    - Stop polling when map view not visible (use visibility/focus detection)
    - Resume polling when map becomes visible again
    - Update shared map store with delta node data
    - _Requirements: 1.2, 1.3_

  - [x] 7.2 Audit and remove any WebSocket usage from consumer apps
    - Audit `apps/web/` and `apps/mobile/` for any WebSocket/socket.io imports or hooks
    - If found, remove them and replace with useDeltaPoll hook integration
    - If no consumer WebSocket hooks exist (likely), this task is a no-op — just wire in useDeltaPoll
    - Verify `apps/staff/`, `backend/src/lambdas/websocket.ts`, and `backend/src/shared/websocket/` remain untouched
    - _Requirements: 1.1, 1.7_

- [ ] 8. Signal display UI components
  - [ ] 8.1 Refactor GenreGlyph to hybrid marker approach
    - Update `packages/shared/components/GenreGlyph.tsx` to REPLACE the standard pulsing circle (not overlay it)
    - When a live signal exists (confidence > 0.15): render the genre icon as the marker itself, pulsing based on `pulseScore` (reuse `computeMarkerStyle` from `packages/shared/lib/markerUtils`)
    - When predicted (no live signal, has CrowdVibeSnapshot): render genre icon in muted/faded style, no pulse animation
    - When no data: do not render GenreGlyph — fall back to standard MapMarker circle
    - Update `packages/shared/components/MapMarker.tsx` to accept a `genreGlyph` prop that replaces the inner circle div when provided
    - When confidence is between 0.15 and 0.3, show glyph with "1 report" indicator
    - Minimum 44px touch target for accessibility
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ] 8.2 Implement GenreLegend component
    - Create `packages/shared/components/GenreLegend.tsx`
    - Accessible from map view via a floating legend button
    - Displays all 12 genre icons with their corresponding genre names in a grid
    - Helps users learn what each glyph represents
    - _Requirements: 3.8_

  - [x] 8.3 Implement predicted genre fallback display
    - When no live signal exists, show top genre from CrowdVibeSnapshot genreCounts
    - Apply Predicted_Indicator styling (muted opacity, "Predicted from visitor tastes" label)
    - When node has neither live signals nor CrowdVibeSnapshot, show no genre info
    - When live signal becomes active, replace predicted display on next poll cycle
    - _Requirements: 3.4, 11.1, 11.2, 11.3, 11.4_

  - [-] 8.4 Write property test for fallback genre selection (Property 14)
    - **Property 14: Fallback Genre Selection**
    - Verify top genre from genreCounts is selected, alphabetical tiebreak for ties
    - Use fast-check arbitrary genreCounts objects
    - **Validates: Requirements 11.1**

  - [x] 8.5 Implement SignalDetail node sheet section
    - Create `packages/shared/components/SignalDetail.tsx`
    - Display genre name, confidence indicator (high >= 0.7, medium >= 0.4, low >= 0.15), time since report
    - Display queue length chip with confidence indicator and time since report
    - Show "Owner report" badge for owner signals
    - Show total report count contributing to consensus
    - When no live signals, show predicted taste profile with top 3 genres and Predicted_Indicator
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 9. Signal submission UI
  - [x] 9.1 Implement SignalReportSheet component
    - Create `packages/shared/components/SignalReportSheet.tsx`
    - Bottom sheet with genre selection (12 genre chips) and queue length selection (3 chips)
    - Allow submitting one or both signal types in single interaction
    - Request GPS permission and include coordinates automatically
    - Show confirmation with Reputation points earned on success; hide points entirely on failure
    - Within 2 minutes of submission, show "Correct" button allowing overwrite of previous signal
    - After 2-minute correction window, disable "Report Signal" button per type for remaining cooldown (5 min total)
    - Only show for authenticated users
    - Only show Reputation points as part of success confirmation, never separately
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 9.2 Implement ReputationStat profile component
    - Create `packages/shared/components/ReputationStat.tsx`
    - Display Reputation stat on user profile as separate metric from check-in count and tier
    - Link to city leaderboard
    - _Requirements: 6.3, 6.4, 6.5_

- [~] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Owner dispute flow and admin moderation
  - [-] 11.1 Implement admin dispute resolution endpoint
    - Add admin route for resolving disputes (dismiss, uphold, expire)
    - Require admin Cognito auth with role support_agent or super_admin
    - On uphold: remove signal from consensus, reduce reporter weight by 0.1
    - On dismiss: restore disputed signal's full confidence weight
    - On expire: remove signal, no penalty
    - Handle all error responses (401, 403, 404, 400, 409)
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

  - [~] 11.2 Implement SignalDisputeQueue admin screen
    - Create `apps/admin/src/screens/SignalDisputeQueue.tsx`
    - Display pending disputes with: signal details, dispute reason, venue name, business name
    - Action buttons: dismiss, uphold, expire
    - Fetch from admin dispute API endpoint
    - _Requirements: 9.1, 9.5_

  - [-] 11.3 Implement contradiction tracking and weight decay
    - Track contradictions per user in 7-day window using KV pattern (pk=KV#signal-contradictions:userId, TTL=7 days)
    - When user accumulates 10+ contradictions in window (V1 threshold; Phase 2 reduces to 5), reduce Reporter_Weight by 0.2 (min 0.1)
    - V1 soft-ban: users at weight 0.1 can still submit signals but they carry minimal weight in consensus (no hard rejection)
    - _Requirements: 10.2, 10.3_

- [ ] 12. Integration wiring and final validation
  - [~] 12.1 Wire signal routes into Fastify app
    - Register signal handler routes in `backend/src/app.ts` (follow existing pattern from other features like `backend/src/features/nodes/handler.ts`)
    - Register delta endpoint in nodes feature module
    - Ensure auth middleware is correctly applied (consumer Cognito pool for signals, business Cognito pool for disputes, admin Cognito pool for moderation)
    - Verify all routes are accessible through API Gateway HTTP API
    - _Requirements: 2.4, 7.4, 8.1, 9.5_

  - [~] 12.2 Wire polling hook and signal UI into consumer apps
    - Integrate useDeltaPoll into map view components in apps/web/ and apps/mobile/
    - Integrate GenreGlyph into map marker components
    - Integrate SignalDetail into node detail sheet
    - Integrate SignalReportSheet trigger button into node detail sheet
    - Integrate ReputationStat into profile page
    - _Requirements: 1.2, 3.1, 4.1, 13.1, 6.3_

  - [~] 12.3 Write integration tests for signal submission flow
    - Test: submit signal → verify storage → verify consensus update → verify reputation increment
    - Test: dispute flow → confidence reduction → admin resolve → weight restoration/penalty
    - Test: delta endpoint returns correct subset based on since timestamp
    - Test: auth flows (consumer accepted, business accepted for owner, unauthenticated rejected)
    - Test: anti-abuse (contradiction detection → weight reduction → soft-ban at weight 0.1)
    - Test: 2-minute correction window overwrites previous signal
    - _Requirements: 2.1, 2.10, 5.6, 6.1, 8.4, 9.3, 10.3_

- [~] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All compute runs on Lambda (arm64), database is DynamoDB (PAY_PER_REQUEST) for signals/nodes/users/app-data, HTTP traffic through API Gateway HTTP API
- Prisma/Postgres exists in the codebase but is NOT used for signals — signals and consensus live in DynamoDB
- The staff app WebSocket infrastructure (`backend/src/lambdas/websocket.ts`, `backend/src/shared/websocket/`) is NOT modified
- The CityUpdatedIndex GSI on the DynamoDB nodes table is the only infrastructure addition (added to both dev and prod Terraform)
- Rate limits and counters use the existing `kvIncr/kvGet` helper from `backend/src/shared/kv/dynamodb-kv.ts`
- Consumer apps may not have existing WebSocket hooks to remove — task 7.2 is an audit-first task

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["1.6", "3.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5"] },
    { "id": 5, "tasks": ["3.6", "4.1", "4.2"] },
    { "id": 6, "tasks": ["4.3", "6.1", "6.2"] },
    { "id": 7, "tasks": ["6.3", "7.1", "7.2"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.4", "9.1", "9.2"] },
    { "id": 9, "tasks": ["8.3", "11.1", "11.3"] },
    { "id": 10, "tasks": ["11.2", "12.1", "12.2"] },
    { "id": 11, "tasks": ["12.3"] }
  ]
}
```
