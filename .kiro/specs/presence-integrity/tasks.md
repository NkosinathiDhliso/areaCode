# Implementation Plan: Presence Integrity

## Overview

This plan builds the honest-presence data foundation incrementally, pure-core first. We
start with the testable pure modules (expiry-window helper, presence reducer state machine,
read-model count) so the correctness properties can be pinned down before any DynamoDB or
HTTP wiring exists. We then add the DynamoDB adapter (conditional writes + counter cache +
dwell sink), the authenticated `POST /v1/check-out` action, the check-in presence
increment, the honest read API, the `node:presence_update` realtime event, the serverless
`arm64` expiry worker, and finally the anonymised dwell-aggregate functions. Every step
builds on the previous and ends wired into the existing check-in pipeline, socket
transport, and client `mapStore`.

All persistence is DynamoDB `PAY_PER_REQUEST`; the only new compute is an `arm64` Lambda on
an EventBridge `rate(5 minutes)` schedule. No phone/SMS path is introduced. Property tests
use **fast-check** + **Vitest**, matching `backend/src/__tests__/properties/`, run at a
minimum of 100 iterations, and are tagged
`// Feature: presence-integrity, Property {n}: {text}`.

## Tasks

- [x] 1. Presence types, schemas, and serverless infrastructure
  - [x] 1.1 Add presence table, TTL, and expiry schedule to Terraform
    - Add `area-code-{env}-presence` DynamoDB table (`billing_mode = "PAY_PER_REQUEST"`, PK `userId`, SK `nodeId`, GSI `NodeIndex` hash `nodeId` / range `expiresAt` projection ALL, TTL attribute `ttl`) to `infra/environments/dev/main.tf` and `infra/environments/prod/main.tf`
    - Add the `presence-expiry` EventBridge `rate(5 minutes)` schedule and its `arm64` Lambda wiring (mirroring `pulse-decay`); introduce no ECS/RDS/ALB/NAT/cache
    - _Requirements: 1.5, 6.1, 6.3, 6.5_
  - [x] 1.2 Define presence types and check-out body schema
    - Create `backend/src/features/check-out/types.ts` with `checkOutBodySchema` (`nodeId` string length 1–128), `CheckOutResponse`, and shared presence types (`PresenceState`, presence record shape, dwell row shape, `node:presence_update` payload), with no phone/identity/coordinate fields
    - _Requirements: 1.4, 2.4, 2.7, 9.5, 10.1_

- [x] 2. Pure expiry-window helper
  - [x] 2.1 Implement `window.ts`
    - Create `backend/src/features/presence/window.ts` exporting `expiryWindowSeconds(nowEpoch)`; reuse the exact `isPeakHour()` SAST 18:00–23:59 boundary from `pulse-decay.ts`; off-peak 5400s / peak 10800s as a single source of truth (founder-flagged defaults)
    - _Requirements: 5.4, 13.1_
  - [ ]* 2.2 Write property test for expiry-window selection
    - **Property 6: Expiry_Window selection follows the SAST peak boundary**
    - **Validates: Requirements 5.4, 5.5**

- [x] 3. Pure presence reducer (state machine)
  - [x] 3.1 Implement `reducer.ts`
    - Create `backend/src/features/presence/reducer.ts` with `applyOp(record, op)` returning `{ record, countDelta, dwellRecorded }` for `check_in` (presence/reward), `check_out`, and `expire`; encode create-or-refresh, at-most-once end, count never below 0, refresh yields delta 0, and dwell valuation/flagging (checkout = `floor(now - checkedInAt)`, expiry = `expiresAt - checkedInAt`)
    - _Requirements: 1.2, 1.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.6, 9.1, 9.2, 9.3_
  - [ ]* 3.2 Write property test for count conservation and at-most-once transitions
    - **Property 1: Count conservation and at-most-once transitions over any operation sequence**
    - **Validates: Requirements 1.3, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.6**
  - [ ]* 3.3 Write property test for dwell recorded exactly once
    - **Property 2: Record end records dwell exactly once, correctly valued and flagged**
    - **Validates: Requirements 1.2, 3.5, 5.1, 5.2, 9.1, 9.2, 9.3**

- [x] 4. Pure honest read-model count
  - [x] 4.1 Implement read-model count function
    - Create `backend/src/features/presence/read-model.ts` exporting a pure `livePresenceCount(records, now)` = count of `present` records with `expiresAt > now`; excludes expired-but-unswept records; returns 0 with no decayed/historical substitution
    - _Requirements: 6.2, 6.4, 7.1, 7.7, 8.3_
  - [ ]* 4.2 Write property test for the honest read model
    - **Property 3: Honest read model reflects only current presence**
    - **Validates: Requirements 6.2, 6.4, 7.1, 7.6, 7.7, 8.3**
  - [ ]* 4.3 Write property test for pulse-decay independence
    - **Property 7: Live_Presence_Count is independent of pulse decay**
    - **Validates: Requirements 8.2**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Presence repository (DynamoDB adapter) and dwell sink
  - [x] 6.1 Implement presence repository
    - Create `backend/src/features/presence/repository.ts`: create-or-refresh conditional `UpdateItem`, conditional end transitions for check-out and expiry, guarded `value > 0` counter increment/decrement against the `app-data` KV row, `NodeIndex` query for the read model (`expiresAt > now`) and the due-sweep (`expiresAt <= now`), and counter reconciliation to the computed count
    - _Requirements: 1.2, 1.3, 1.5, 3.2, 3.3, 3.4, 4.1, 4.2, 5.6, 6.4_
  - [x] 6.2 Implement dwell aggregate sink writer
    - Add the anonymised dwell-row writer to the `app-data` table (`pk = DWELL#<nodeId>#<yyyy-mm-dd>`, `durationSeconds`, `termination`, `timeBand`, `endedAt`, `ttl`) with no `userId`/identity/coordinates; `PAY_PER_REQUEST`
    - _Requirements: 9.4, 9.5, 10.3_
  - [ ]* 6.3 Write property test for no coordinates and one record per consumer-venue
    - **Property 8: No coordinates and at most one record per consumer-venue**
    - **Validates: Requirements 9.5, 10.1, 10.2**
  - [ ]* 6.4 Write unit tests for repository conditional behavior
    - Conditional end no-ops on absent/checked-out/expired records; guarded decrement never drops below 0; reconciliation recomputes from records
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 7. Check-out action (`POST /v1/check-out`)
  - [x] 7.1 Implement check-out service
    - Create `backend/src/features/check-out/service.ts`: load user (`403 account_disabled` on disabled, no state change), attempt conditional end transition; on success decrement counter, write dwell row, return `{ checked_out, dwellSeconds }`; on `ConditionalCheckFailedException` return `{ no_active_presence, dwellSeconds: null }` as a successful no-op; expose no reward coupling (founder decision 13.2)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.3, 3.1, 3.2, 3.3, 3.5, 13.2_
  - [x] 7.2 Implement and register the check-out route
    - Create `backend/src/features/check-out/handler.ts` registering `POST /v1/check-out` with preHandler order `requireAuth('consumer')` → `rateLimitMiddleware({ key: 'check-out', max: 10, windowSeconds: 60 })` → `validate({ body: checkOutBodySchema })` → service; reuse existing `AppError` HTTP semantics
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7_
  - [ ]* 7.3 Write unit tests for the check-out route
    - Response shape on success (1.4); schema rejects `nodeId` length 0 and 129, accepts 1 and 128; preHandler ordering; missing JWT → 401; disabled → 403; 11th request → 429 (each asserting no state change); body contains only `nodeId`, no phone/SMS path
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 2.7_

- [x] 8. Presence increment on check-in
  - [x] 8.1 Wire presence open/refresh into the check-in service
    - Modify `backend/src/features/check-in/service.ts` to open-or-refresh a Presence_Record after existing validations and the check-in insert, for both `type = 'presence'` and `type = 'reward'`; increment the counter only on a new/reopened presence; wrap in `try/catch` so a presence-write failure still returns a successful check-in
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 8.2 Write unit tests for check-in presence increment
    - Failed check-in validation writes no presence record (4.4); injected presence-write failure still returns success (4.5); re-check-in of a live record refreshes `expiresAt` without a second increment (4.2)
    - _Requirements: 4.2, 4.4, 4.5_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Honest presence read API
  - [x] 10.1 Add `GET /v1/nodes/:nodeId/presence`
    - Extend the existing nodes feature (`backend/src/features/nodes/...`) with a route returning `{ nodeId, livePresenceCount }` computed from the `NodeIndex` record query (`expiresAt > now`, `present`); never trust the cached counter over the record query
    - _Requirements: 7.1, 7.6, 7.7, 6.4_
  - [ ]* 10.2 Write unit test for the read endpoint
    - Returns the documented shape; excludes expired-but-unswept records; reports 0 honestly with no decayed substitution
    - _Requirements: 7.7, 6.4_

- [x] 11. Presence_Event realtime broadcast
  - [x] 11.1 Add the `node:presence_update` event and emit/broadcast functions
    - Add `node:presence_update` to `shared/socket/events.ts` + `types.ts` and `shared/websocket/broadcast.ts`; implement `emitPresenceUpdate` (Socket.io) and `broadcastPresenceUpdate` (API GW WebSocket) carrying only `{ nodeId, livePresenceCount, cause }`; do not repurpose `checkInCount` (founder decision 13.4)
    - _Requirements: 7.3, 7.4, 8.4, 10.4_
  - [x] 11.2 Wire best-effort emission into check-out, check-in, and expiry
    - Emit `node:presence_update` (cause `check_out`/`check_in`/`expiry`) after each count-changing transition, wrapped so a fan-out failure is logged and never rolls back the committed operation; payload count equals the recomputed authoritative read-model value
    - _Requirements: 7.2, 7.5, 7.6_
  - [ ]* 11.3 Write property test for event count agreement
    - **Property 4: Presence_Event count agrees with the authoritative read model**
    - **Validates: Requirements 7.2, 7.6**
  - [ ]* 11.4 Write property test for event payload carrying no identity
    - **Property 5: Presence_Event payload carries no consumer identity**
    - **Validates: Requirements 7.4, 10.4**
  - [x] 11.5 Consume the event in the client store
    - Update `packages/shared/hooks/useNodePulse.ts` to subscribe to `node:presence_update` and write `payload.livePresenceCount` into `mapStore.checkInCounts[nodeId]`; map's "people here now" surface is driven by `livePresenceCount`; initial load uses the read API
    - _Requirements: 7.1, 7.3_
  - [ ]* 11.6 Write integration test for event delivery to the client store
    - Emitting `node:presence_update` over the existing WebSocket reaches the store backing `mapStore.checkInCounts`
    - _Requirements: 7.3_

- [x] 12. Serverless presence-expiry worker
  - [x] 12.1 Implement the expiry worker
    - Create `backend/src/workers/presence-expiry.ts` (`arm64`, EventBridge `rate(5 minutes)`), mirroring `pulse-decay` per-city iteration; query `NodeIndex` for due records (`expiresAt <= now`, `present`), apply the conditional expire transition (`endedAt = expiresAt`), guarded counter decrement, dwell row flagged `expiry_terminated`, emit event cause `expiry`, then reconcile the counter to the computed count
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 6.1, 6.2, 6.3, 6.5_
  - [ ]* 12.2 Write integration test for the expiry worker
    - On a seeded set of due records: transitions them, decrements, writes dwell rows flagged expiry-terminated, and emits events end-to-end against local DynamoDB
    - _Requirements: 5.1, 5.2, 5.6_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Anonymised dwell-time aggregation (business intelligence)
  - [x] 14.1 Implement dwell aggregate functions
    - Create `backend/src/features/presence/aggregate.ts` computing per-venue/period average, median, and distribution by time band from dwell rows; split `checkout_terminated` vs `expiry_terminated`; suppress with an insufficient-data indicator below `MIN_DWELL_SAMPLE`; output carries no identity or coordinates
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.3_
  - [ ]* 14.2 Write property test for anonymised aggregate output
    - **Property 9: Anonymised aggregate output contains no identity or coordinates**
    - **Validates: Requirements 10.3, 12.4**
  - [ ]* 14.3 Write property test for aggregate statistics
    - **Property 10: Dwell aggregate statistics match a reference computation**
    - **Validates: Requirements 12.1**
  - [ ]* 14.4 Write property test for termination-type partition
    - **Property 11: Aggregates partition cleanly by termination type**
    - **Validates: Requirements 12.2**
  - [ ]* 14.5 Write property test for minimum-sample suppression
    - **Property 12: Minimum-sample suppression**
    - **Validates: Requirements 12.3**

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific granular requirements for traceability.
- The pure modules (`window.ts`, `reducer.ts`, `read-model.ts`, `aggregate.ts`) are the
  executable specification; the DynamoDB repository is a thin adapter that maps each
  operation to the corresponding conditional write.
- Property tests validate the 12 universal correctness properties; unit and integration
  tests cover specific examples, edge cases, and wiring.
- Founder-flagged values (Requirement 13) live as single-source-of-truth constants
  (`window.ts` durations, no reward coupling, dedicated event field, capture-now dwell) so a
  change is a one-line edit.
- Auto_Check_Out (Requirement 11) is deferred; nothing here depends on it.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["2.2", "3.2", "3.3", "4.2", "4.3", "6.1", "6.2", "11.1"] },
    { "id": 2, "tasks": ["6.3", "6.4", "7.1", "8.1", "10.1", "11.5"] },
    { "id": 3, "tasks": ["7.2", "8.2", "10.2", "12.1", "14.1"] },
    { "id": 4, "tasks": ["7.3", "11.2", "14.2", "14.3", "14.4", "14.5"] },
    { "id": 5, "tasks": ["11.3", "11.4", "11.6", "12.2"] }
  ]
}
```
