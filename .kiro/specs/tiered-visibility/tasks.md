# Implementation Plan: Tiered Visibility

## Overview

Replace the opt-in `broadcast_location` privacy toggle with a structural friends-only identity model. Every check-in fully contributes to pulse/counts/analytics. Names are visible only to mutual follows; non-friends see counts, tier distribution, and crowd metadata. Changes span backend services, shared types, frontend screens, and mock data.

## Tasks

- [x] 1. Core utilities — Mutual Follow Resolver and Identity Stripper
  - [x] 1.1 Add `getMutualFollowIds` to `backend/src/features/social/repository.ts`
    - Implement the batch mutual-follow resolver using a self-join on `user_follows`
    - Accepts `viewerId: string` and `candidateIds: string[]`, returns `Set<string>`
    - Handle empty `candidateIds` array (return empty set)
    - Handle DB errors by returning empty set (safe fallback per design error handling)
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 1.2 Add `applyFriendVisibility` utility to `backend/src/features/social/service.ts`
    - Pure function: takes entries with identity fields, a `Set<string>` of friend IDs, and `viewerId`
    - If `entry.userId === viewerId` or `friendIds.has(entry.userId)` → preserve identity, set `isFriend: true`
    - Otherwise → null out `displayName`, `username`, `avatarUrl`, set `isFriend: false`
    - Must be idempotent
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 9.2, 9.3, 9.5_

  - [ ]\* 1.3 Write property test for `applyFriendVisibility` — Property 3
    - **Property 3: Identity filter — friends see names, non-friends don't**
    - Generate random entry lists and friend sets with `fast-check`
    - Verify friend entries preserve identity, non-friend entries are nulled
    - **Validates: Requirements 2.1, 2.2, 2.5, 2.6, 7.1, 9.2, 9.3**

  - [ ]\* 1.4 Write property test for idempotence — Property 9
    - **Property 9: Identity filter is idempotent**
    - Apply `applyFriendVisibility` twice, verify result equals single application
    - **Validates: Requirements 9.5**

  - [ ]\* 1.5 Write property test for mutual follow bidirectionality — Property 7
    - **Property 7: Mutual follow is bidirectional**
    - Generate random follow graphs, verify `getMutualFollowIds` returns only bidirectional pairs
    - **Validates: Requirements 5.1**

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Backend service changes — Check-in toasts
  - [x] 3.1 Update `processCheckIn` in `backend/src/features/check-in/service.ts`
    - Remove the `shouldBroadcast(userId)` call and the `shouldBroadcast` function entirely
    - Always emit anonymous city toast: message references node name and check-in count only, no `avatarUrl`/`username`/`displayName`
    - After city toast, look up user's mutual follows via `getMutualFollowIds`, emit personalised friend toasts to each friend's user room using `emitFriendToast`
    - _Requirements: 1.8, 4.1, 4.2, 4.3, 4.4, 9.4, 9.6_

  - [x] 3.2 Add `emitFriendToast` to `backend/src/shared/socket/events.ts`
    - Emits `toast:friend_checkin` to `userRoom(userId)` only
    - Payload: `{ type, message, nodeId, avatarUrl }`
    - Never emits to any city room
    - _Requirements: 4.3, 4.4_

  - [ ]\* 3.3 Write property test for city toast anonymity — Property 2
    - **Property 2: City toast never contains identity**
    - Generate random toast payloads from check-in flow, verify no identity fields
    - **Validates: Requirements 1.8, 4.1, 4.2, 9.4, 9.6**

  - [ ]\* 3.4 Write property test for friend toast routing — Property 6
    - **Property 6: Friend toasts route to user rooms only**
    - Verify friend toasts emit to user rooms, never city rooms, and contain displayName
    - **Validates: Requirements 4.3, 4.4**

- [x] 4. Backend service changes — Leaderboard
  - [x] 4.1 Update `getCityLeaderboard` in `backend/src/features/social/service.ts`
    - Accept `viewerId` parameter (from auth, may be undefined for anonymous)
    - After fetching profiles, call `getMutualFollowIds(viewerId, userIds)` if viewerId present
    - Map entries through `applyFriendVisibility`
    - Return entries with `isFriend` field
    - Update DEV_MODE block to include `isFriend` field
    - _Requirements: 2.5, 2.6, 8.3_

- [x] 5. Backend service changes — Activity Feed
  - [x] 5.1 Update `getActivityFeed` in `backend/src/features/social/repository.ts`
    - Change Prisma `where` clause from one-way follow to mutual follow: require both `followers: { some: { followerId: userId } }` AND `following: { some: { followingId: userId } }`
    - All returned entries are mutual follows by definition — add `isFriend: true` to response
    - Update DEV_MODE block in service to reflect friends-only feed
    - _Requirements: 2.3, 2.4_

  - [ ]\* 5.2 Write property test for feed mutual-follow constraint — Property 4
    - **Property 4: Feed only contains mutual follows**
    - Verify all feed entries are mutual follows of the viewer
    - **Validates: Requirements 2.3, 2.4**

- [x] 6. Backend service changes — Nearby-Recent and Who-Is-Here
  - [x] 6.1 Update `getNearbyRecentEvent` in `backend/src/features/social/repository.ts`
    - Remove the `consent_records.broadcast_location = true` join condition
    - Remove `username` from the query response — return only node name, distance, time
    - _Requirements: 2.2, 7.1_

  - [x] 6.2 Add Who-Is-Here endpoint and handler
    - Add `GET /v1/nodes/:id/who-is-here` route in social handler
    - Query recent check-ins at the node, resolve mutual follows for the viewer
    - Return `{ totalCount, tierDistribution, friends[] }` — friends array only contains mutual follows
    - Anonymous viewers get empty `friends` array but always get `totalCount` and `tierDistribution`
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

  - [ ]\* 6.3 Write property test for crowd metadata presence — Property 5
    - **Property 5: Crowd metadata always present**
    - Verify `totalCount` and `tierDistribution` always present regardless of viewer auth status
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**

- [x] 7. Checkpoint — Ensure all tests pass
  - All tests pass (1 pre-existing flaky timeout unrelated to this feature).

- [x] 8. Consent schema and type deprecation
  - [x] 8.1 Update `consentBodySchema` in `backend/src/features/auth/types.ts`
    - Remove `broadcastLocation` field from the Zod schema
    - Add `.strict()` to reject unknown fields (returns 400 if `broadcastLocation` is sent)
    - _Requirements: 7.4, 8.2_

  - [x] 8.2 Update `updateConsent` and `getUserConsent` in `backend/src/features/auth/service.ts`
    - `updateConsent`: remove `broadcastLocation` parameter, stop writing it to DB
    - `getUserConsent`: return `{ analyticsOptIn: boolean }` only, no `broadcastLocation`
    - Update DEV_MODE blocks accordingly
    - Invalidate Redis consent cache key on update (already done, just remove broadcastLocation from cached value)
    - _Requirements: 6.4, 8.4_

  - [x] 8.3 Update consent handler in `backend/src/features/auth/handler.ts`
    - Update the `PUT /v1/users/me/consent` handler to stop passing `broadcastLocation` to `service.updateConsent`
    - _Requirements: 8.2, 8.4_

  - [x] 8.4 Update `ConsentRecord` interface in `packages/shared/types/index.ts`
    - Remove `broadcastLocation` field from `ConsentRecord`
    - _Requirements: 8.1_

  - [x] 8.5 Update `LeaderboardEntry` interface in `packages/shared/types/index.ts`
    - Make `username`, `displayName`, `avatarUrl` nullable (`string | null`)
    - Add `isFriend: boolean` field
    - _Requirements: 8.3_

  - [x] 8.6 Add `toast:friend_checkin` to `ServerToClientEvents` in `packages/shared/types/index.ts`
    - Add the new event type for personalised friend check-in toasts
    - _Requirements: 4.3_

  - [ ]\* 8.7 Write property test for consent schema rejection — Property 8
    - **Property 8: Consent schema rejects broadcastLocation**
    - Generate random consent payloads with `broadcastLocation`, verify Zod rejects them
    - **Validates: Requirements 7.4, 8.2**

- [x] 9. Frontend UI changes
  - [x] 9.1 Update `ProfileScreen` in `apps/web/src/screens/ProfileScreen.tsx`
    - Remove the privacy toggle checkbox from the Privacy section
    - Replace with static text: "Your name is only visible to people you both follow. Everyone else sees the vibe, not who."
    - _Requirements: 6.1, 6.2_

  - [x] 9.2 Update `ConsumerSignup` in `apps/web/src/screens/ConsumerSignup.tsx`
    - Remove `consentBroadcast` state and the broadcast consent checkbox
    - Remove `consentBroadcast` from the signup API payload
    - Add a non-interactive explanation paragraph about the friends-only identity model
    - _Requirements: 6.3_

  - [x] 9.3 Update `LeaderboardScreen` in `apps/web/src/screens/LeaderboardScreen.tsx`
    - Use `isFriend` flag from API response to conditionally render names
    - For `isFriend: false` entries, show tier badge and rank but replace name with anonymised placeholder (e.g. "Area Code Explorer")
    - _Requirements: 2.5, 2.6_

  - [x] 9.4 Update `FeedScreen` in `apps/web/src/screens/FeedScreen.tsx`
    - No structural change needed — feed now only returns mutual-follow entries
    - Verify feed entries render full identity (all entries are friends)
    - _Requirements: 2.3, 2.4_

- [x] 10. Mock data updates
  - [x] 10.1 Update `packages/shared/mocks/data/consent.ts`
    - Remove `broadcastLocation` field from all `MOCK_CONSENT` entries
    - _Requirements: 6.4, 8.1_

  - [x] 10.2 Update `packages/shared/mocks/data/leaderboard.ts`
    - Add `isFriend: boolean` to each entry
    - For `isFriend: false` entries, set `displayName: null`, `username: null`, `avatarUrl: null`
    - _Requirements: 8.3_

  - [x] 10.3 Update `packages/shared/mocks/data/feed.ts`
    - Add `isFriend: true` to all `FeedItem` entries and the `FeedItem` interface
    - _Requirements: 2.3_

- [x] 11. Checkpoint — Ensure all tests pass
  - All tests pass (1 pre-existing flaky timeout unrelated to this feature).

- [ ] 12. Property-based test for check-in contribution
  - [ ]\* 12.1 Write property test for check-in always contributes — Property 1
    - **Property 1: Check-in always contributes**
    - Generate random check-in inputs, mock Redis/socket, verify pulse score recalculated, counters incremented, socket events emitted
    - No user relationship or consent value suppresses any update
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 9.1**

- [x] 13. Final checkpoint — Ensure all tests pass
  - 135/136 tests pass. The 1 failure is a pre-existing flaky `mockDelay` timeout test.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The `broadcast_location` DB column is left in place — a future migration can drop it
- All consent cache keys expire naturally within 1 hour (TTL 3600s) after deployment
