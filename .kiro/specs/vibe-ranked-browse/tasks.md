# Implementation Plan: Vibe-Ranked Browse

## Overview

This plan implements the full lexicographic ranking with taste-match (archetype affinity + friends presence), business tier boost, live gets signal, and a "Top 2 + More" entry point. It also introduces City Ranks (archetype-segmented leaderboard) and City Feed (vibe-enriched activity feed with "Join them?" CTAs, archetype clustering, and shareable milestones). All work extends existing files and stores (DRY rule) - no new DynamoDB tables or always-on infra.

## Tasks

- [x] 1. Extend ranking interfaces and implement taste-match scoring
  - [x] 1.1 Extend `RankInput` interface and add `tasteMatchScore` helper in `apps/web/src/lib/carouselRanking.ts`
    - Add new fields to `RankInput`: `consumerArchetypeId`, `venueArchetypeIds`, `friendsAtVenue`, `hasLiveGets`
    - Do NOT add `tierMultipliers` or `defaultArchetypeIds` maps: tier comes from `TIER_SIZE_MULTIPLIER[node.businessTier ?? 'starter']` and default archetype from `node.defaultArchetypeId`, both read off the `Node` already in `venues` (single source of truth, matches R1 priority 3 and R2.1)
    - Implement `tasteMatchScore(consumerArchetypeId, venueArchetypeId, friendsAtVenueCount): number`
    - Implement `resolveArchetype(node, venueArchetypeIds): string` helper (live override -> `node.defaultArchetypeId` -> `'archetype-eclectic'`)
    - Ensure backward-compat: when new fields are missing/empty, taste-match = 0 for all
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 1.2 Implement new lexicographic `vibeRank` comparator
    - Replace the existing 3-signal sort (vibe -> distance -> id) with the full 6-signal lexicographic sort: taste-match -> aliveness -> tier -> live-gets -> distance -> id
    - Distance signal skipped when `positionFresh = false` or `lastKnownPosition = null` (not treated as zero)
    - Maintain purity - no I/O, no Date.now inside the sort
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 8.1, 8.2, 8.3_

  - [ ]\* 1.3 Write property test: Lexicographic Dominance (Property 1)
    - **Property 1: Lexicographic Dominance**
    - Generate random venue pairs with one signal strictly higher, all prior signals equal
    - Assert the higher-signal venue always outranks regardless of lower-priority signals
    - Use fast-check with 200 iterations
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 5.3, 5.4, 8.1, 8.2**

  - [ ]\* 1.4 Write property test: Total Deterministic Order (Property 2)
    - **Property 2: Total Deterministic Order**
    - Generate full random `RankInput` scenarios
    - Assert output is a permutation (no drops/dupes) and two calls with identical input produce identical output
    - **Validates: Requirements 1.7, 1.8**

  - [ ]\* 1.5 Write property test: Graceful Degradation (Property 3)
    - **Property 3: Graceful Degradation**
    - Generate scenarios with null archetype, empty friends, stale position
    - Assert ranking equals aliveness -> tier -> live-gets -> venue-id (taste-match effectively 0, distance skipped)
    - **Validates: Requirements 1.6, 2.6, 2.7, 7.1, 7.2**

- [x] 2. Implement friends presence store and live gets derivation
  - [x] 2.1 Extend `mapStore` with `friendsAtVenue` and `hasLiveGets` slices in `packages/shared/stores/mapStore.ts`
    - Add `friendsAtVenue: Record<string, string[]>` (nodeId -> userId[])
    - Add `hasLiveGets: Record<string, boolean>` (nodeId -> boolean)
    - Add actions: `setFriendsPresence`, `addFriendPresence`, `removeFriendPresence`, `clearFriendsPresence`, `setHasLiveGets`
    - `addFriendPresence` must dedupe (no-op when the userId is already present at that node) so a repeated `toast:friend_checkin` never double-counts taste-match
    - `clearFriendsPresence` is called on logout; store must be empty when user is unauthenticated
    - _Requirements: 3.2, 3.3, 3.6, 5.1, 5.2_

  - [x] 2.2 Implement `filterActiveFriends` helper in `apps/web/src/lib/carouselRanking.ts`
    - Pure function: filters friend entries by `expiresAt > nowMs`
    - Returns `Record<string, string[]>` (nodeId -> active userId[])
    - _Requirements: 2.8, 3.5_

  - [x] 2.3 Implement `deriveHasLiveGets` helper in `apps/web/src/lib/carouselRanking.ts`
    - Pure function: given rewards array, returns `Record<string, boolean>`
    - Only `lifecycle === 'live'` AND `getCategory in {'event', 'offer'}` qualify
    - _Requirements: 5.3, 5.4, 5.5_

  - [ ]\* 2.4 Write property test: Honest Friends Presence (Property 4)
    - **Property 4: Honest Friends Presence**
    - Generate friend entries with random `expiresAt` timestamps around `nowMs`
    - Assert count equals only friends whose presence has NOT expired
    - **Validates: Requirements 2.8, 3.5, 13.4**

  - [ ]\* 2.5 Write property test: Live Gets Lifecycle Fidelity (Property 5)
    - **Property 5: Live Gets Lifecycle Fidelity**
    - Generate rewards arrays with random lifecycles ('live', 'upcoming', 'ended')
    - Assert `hasLiveGets` is true iff at least one reward has event/offer + lifecycle 'live'
    - **Validates: Requirements 5.5**

- [x] 3. Checkpoint - Core ranking logic verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Friends presence API and socket wiring
  - [x] 4.1 Create `GET /v1/friends/presence` Lambda endpoint in backend
    - Add handler in `backend/src/features/social/` (or appropriate existing module)
    - Query `AppData_Table` for active check-ins of the consumer's mutual friends (`expiresAt > now`)
    - Response: `{ items: Array<{ nodeId: string; userId: string; expiresAt: string }> }`
    - Auth: `requireAuth('consumer')` - unauthenticated requests get 401 (the client does not call it when logged out, so the store stays empty per R3.3); do NOT return an empty 200 for anonymous callers
    - _Requirements: 3.1, 3.3, 3.5, 14.1_

  - [x] 4.2 Wire socket events for friends presence on the client
    - Hook into `toast:friend_checkin` event -> call `addFriendPresence(nodeId, userId)` (depends on the payload extension in 4.3)
    - Add listener for new `friend:checkout` event -> call `removeFriendPresence(nodeId, userId)`
    - Seed store from `GET /v1/friends/presence` on session start: run `filterActiveFriends(items, Date.now())` then `setFriendsPresence`
    - Re-seed on socket reconnect (recovers checkouts missed while offline)
    - Clear store on logout
    - _Requirements: 3.1, 3.4, 3.5, 14.1_

  - [x] 4.3 Extend `toast:friend_checkin` payload and emit `friend:checkout` from backend
    - Add a required `userId: string` and required `nodeId: string` to the `toast:friend_checkin` payload in `packages/shared/types/index.ts` AND `backend/src/shared/socket/types.ts` (current payload `{ type, message, nodeId?, avatarUrl? }` carries neither), and populate them in the emit (`events.ts` / `broadcast.ts`). Without this the client cannot maintain a `nodeId -> userId[]` store
    - When a check-in expires or user checks out, emit `friend:checkout` to their mutual friends with payload `{ userId: string; nodeId: string }`; add this event to both `ServerToClientEvents` type definitions
    - _Requirements: 3.1, 3.4, 3.5_

  - [x]\* 4.4 Write integration tests for friends presence API
    - Test returns only active (non-expired) friends
    - Test returns empty for unauthenticated users
    - Test socket event triggers store update
    - _Requirements: 3.3, 3.4, 3.5_

- [x] 5. Top 2 + More entry point
  - [x] 5.1 Implement browse strip state reducer and Top 2 + More logic
    - Add `BrowseStripState` and `browseReducer` in carousel module (or PeekCarousel) - this is the Property 7 (state machine) target
    - States: `OPEN` / `FILTER_CHANGE` -> top 2 view; `TAP_MORE` -> expanded; `DISMISS` -> reset
    - Add a SEPARATE pure selector `deriveBrowseStrip(ranked, isExpanded): { visible: Node[]; showMore: boolean }` - this is the Property 6 (Top 2 initial display) target, distinct from the reducer
    - When < 3 venues: `showMore = false` and all venues are visible (so collapsed and expanded views are identical)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.2 Update `PeekCarousel` component to render Top 2 + More UI
    - Show exactly top 2 ranked venues on open / filter change
    - Render "Keep exploring" card as third element (keyboard-operable, accessible label)
    - On tap, expand to full ranked list with FlickControls / swipe
    - Map still snaps/flies to Active_Venue in top 2 view
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 6.1, 6.2, 6.3_

  - [x]\* 5.3 Write property test: Top 2 Initial Display (Property 6)
    - **Property 6: Top 2 Initial Display**
    - Generate ranked lists of 0-20 venues
    - Assert: >=3 venues -> show exactly first 2 + "More"; <3 venues -> show all, no "More"
    - **Validates: Requirements 4.1, 4.2, 4.5**

  - [x]\* 5.4 Write property test: Browse Expansion State Machine (Property 7)
    - **Property 7: Browse Expansion State Machine**
    - Generate random action sequences
    - Assert: after TAP_MORE, remains expanded until DISMISS or FILTER_CHANGE resets
    - **Validates: Requirements 4.4**

- [x] 6. Checkpoint - Browse ranking and Top 2 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. City Ranks - Leaderboard evolution
  - [x] 7.1 Extend leaderboard backend endpoint with archetype segment and venue streak
    - Add optional `archetypeId` query param to `GET /v1/leaderboard/:citySlug`
    - Add `segment` field to response ('archetype' | 'city-wide')
    - Add `topVenueId`, `topVenueName`, `archetypeId` to each `LeaderboardEntry`
    - Filter expression on existing query (<=50 entries, no new GSI needed)
    - _Requirements: 10.1.1, 10.1.2, 10.2.1, 14.3, 14.5_

  - [x] 7.2 Implement venue streak derivation (`deriveTopVenue`) in leaderboard service
    - For each user in the leaderboard period, find the venue with the most check-ins
    - Tie: most recently visited venue wins
    - Respect privacy settings - only show venues where user's privacy allows
    - _Requirements: 10.2.1, 10.2.3_

  - [x] 7.3 Update `LeaderboardScreen` UI for archetype-segmented ranks
    - Default view: consumer's archetype rank (e.g. "Top Nomads this week in Joburg")
    - Secondary toggle/tab for city-wide view
    - When consumer has no `archetypeId`, default to city-wide with prompt to complete preferences
    - Each entry shows: rank, avatar/badge, display name (friend) or "Anonymous Explorer", tier badge, weekly count, venue streak callout
    - _Requirements: 10.1.1, 10.1.2, 10.1.3, 10.1.4, 10.2.1, 10.2.2_

  - [x] 7.4 Implement tier progression nudge on consumer's rank card
    - Show compact progress indicator: "7 more to Fixture"
    - At highest tier (Legend): show celebratory label
    - _Requirements: 10.4.1, 10.4.2_

  - [x]\* 7.5 Write property test: Venue Streak Derivation (Property 8)
    - **Property 8: Venue Streak Derivation**
    - Generate random check-in histories
    - Assert `topVenueId` is the venue with max check-ins (tie: most recent wins)
    - **Validates: Requirements 10.2.1**

  - [ ]\* 7.6 Write unit tests for leaderboard endpoint
    - Test `archetypeId` filter returns only matching entries
    - Test backward compatibility: no `archetypeId` param returns city-wide
    - Test privacy-gated venue callouts
    - _Requirements: 10.1.1, 10.2.3, 14.3_

- [x] 8. City Ranks - Share affordance
  - [x] 8.1 Implement client-side share card generator in `apps/web/src/lib/shareCard.ts`
    - First implement the pure `buildShareCardData(stats): ShareCardData` (own data only) - this is the Property 9 target; `generateShareCard` renders from its output
    - `generateShareCard(data: ShareCardData): Promise<Blob>` using canvas rendering
    - Card content: rank, archetype glyph + name, tier badge, weekly check-in count, top venue
    - No other users' personal data on the card
    - _Requirements: 10.3.2, 10.3.4, 13.1_

  - [x] 8.2 Implement `shareOrCopy` utility using Web Share API with clipboard fallback
    - Use `navigator.share` when available
    - Fallback: copy text summary + deep-link URL to clipboard
    - _Requirements: 10.3.1, 10.3.3, 12.3_

  - [ ]\* 8.3 Write property test: Share Card Privacy (Property 9)
    - **Property 9: Share Card Privacy**
    - Generate share card data with various inputs
    - Assert card content contains only the generating consumer's own data
    - **Validates: Requirements 10.3.4, 13.1**

- [x] 9. Checkpoint - City Ranks complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. City Feed - Vibe enrichment and "Join them?" CTA
  - [x] 10.1 Extend feed backend endpoint with vibe enrichment
    - Add `venuePulseState`, `venueCheckInCount`, `venueArchetypeId`, `friendStillPresent` to feed item response
    - Join venue pulse state at read time from live node state (honest presence - current state, not historical)
    - Determine `friendStillPresent` from active check-in data
    - Add `feedType` discriminator: 'checkin' | 'milestone' | 'live_get' | 'archetype_cluster'
    - No N+1 queries - join server-side or cached
    - _Requirements: 11.1.1, 11.1.3, 11.2.1, 14.2_

  - [x] 10.2 Update `FeedScreen` with enriched feed items and "Join them?" CTA
    - Show venue pulse state badge, live check-in count, and archetype glyph on each item
    - Visual accent (coloured pulse-state badge/border glow) for `popping`/`buzzing` venues
    - "Join them?" button: only when `friendStillPresent = true` AND venue state in `active/buzzing/popping`
    - Extract the eligibility check into a pure `isJoinEligible(friendStillPresent, pulseState): boolean` helper (the Property 10 target) rather than inlining it in JSX
    - Tapping "Join them?" -> Focus_Signal to venue (fly map there, open carousel)
    - _Requirements: 11.1.1, 11.1.2, 11.2.1, 11.2.2, 11.2.3, 12.1_

  - [x]\* 10.3 Write property test: "Join Them?" Eligibility (Property 10)
    - **Property 10: "Join Them?" Eligibility**
    - Generate random (friendPresent, pulseState) tuples
    - Assert CTA shown iff friendStillPresent=true AND pulseState in {active, buzzing, popping}
    - **Validates: Requirements 11.2.1, 11.2.3**

- [x] 11. City Feed - Archetype clustering and live gets
  - [x] 11.1 Implement archetype cluster section in feed backend
    - When consumer has `archetypeId`, include a pinned cluster of top 3-5 recent check-ins from same-archetype users
    - Privacy-gated: only `public` privacy-level check-ins from non-friends (mutual friends always included)
    - Extract membership selection into a pure `filterArchetypeCluster(items, consumerArchetypeId): FeedItem[]` helper (the Property 11 target)
    - Label with consumer's archetype name (e.g. "Nomads are at...")
    - _Requirements: 11.3.1, 11.3.2, 11.3.3, 13.2, 13.3_

  - [x] 11.2 Implement live gets feed items
    - Insert feed item when a venue within consumer's proximity radius drops a new live event/offer
    - Show venue name, get title, "Live now" badge
    - Only for venues within `getRewardsNearMe` radius
    - Expired gets never appear; extract a pure `filterLiveGets(rewards, nowMs)` helper (the Property 12 target) that keeps only `getCategory in {event, offer}` with `lifecycle === 'live'`
    - _Requirements: 11.4.1, 11.4.2, 11.4.3, 11.4.4_

  - [x] 11.3 Implement feed ordering logic (client-side `sortFeedItems`)
    - Archetype cluster pinned at top (position 0)
    - "Happening now" items (friend currently present at alive venue) promoted above chronological
    - Remaining items reverse-chronological
    - _Requirements: 11.6.1, 11.6.2_

  - [x]\* 11.4 Write property test: Archetype Cluster Membership (Property 11)
    - **Property 11: Archetype Cluster Membership**
    - Generate feed items with mixed archetypes
    - Assert every item in the cluster matches the consumer's archetypeId
    - **Validates: Requirements 11.3.2**

  - [x]\* 11.5 Write property test: Feed Excludes Ended Gets (Property 12)
    - **Property 12: Feed Excludes Ended Gets**
    - Generate reward arrays with random lifecycles
    - Assert no feed item has lifecycle 'ended' or 'upcoming'
    - **Validates: Requirements 11.4.4**

  - [x]\* 11.6 Write property test: Feed Ordering Invariant (Property 14)
    - **Property 14: Feed Ordering Invariant**
    - Generate random feed items with mixed types/timestamps
    - Assert: cluster at position 0, then happening-now, then reverse-chronological rest
    - **Validates: Requirements 11.6.1, 11.6.2**

- [x] 12. City Feed - Shareable milestones
  - [x] 12.1 Implement milestone generation in backend
    - Auto-generate milestone records for: first check-in at new venue, tier advancement, streak achievements (3/7/14/30 day), leaderboard rank milestones (top 10, top 3, #1)
    - Trigger points (no new schedulers - hook the existing flows):
      - first-visit + streak (3/7/14/30): in the check-in service, after `repository.ts` computes `streakCount` (see `updateStreak`, check-in/repository.ts:113-126), evaluate and write the milestone
      - tier advancement: at the same point the backend emits the existing `tier:changed` event
      - rank milestones (top 10/3/1): in the leaderboard-reset worker (`backend/src/workers/leaderboard-reset.ts`) when ranks are finalised for the period
    - Store in `AppData_Table` with `PK: MILESTONE#{userId}`, `SK: {type}#{qualifier}` (e.g. `streak#7`, `tier#fixture`, `rank#1#{weekEnding}`)
    - Idempotent: conditional put with `attribute_not_exists(sk)`; swallow `ConditionalCheckFailedException`
    - _Requirements: 11.5.1, 11.5.5, 14.5_

  - [x] 12.2 Render milestone feed items with share capability
    - Display milestone entries in feed with "Share" button
    - Reuse `generateShareCard` + `shareOrCopy` from task 8.1/8.2
    - Card: milestone, avatar, archetype glyph, tier badge - formatted for Instagram/WhatsApp stories
    - Use Web Share API with clipboard fallback
    - _Requirements: 11.5.2, 11.5.3, 11.5.4, 12.3_

  - [x]\* 12.3 Write property test: Milestone Idempotency (Property 13)
    - **Property 13: Milestone Idempotency**
    - Generate repeated milestone triggers for the same type+qualifier
    - Assert exactly one feed entry per unique milestone
    - **Validates: Requirements 11.5.5**

- [x] 13. Checkpoint - City Feed complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Cross-surface integration and privacy compliance
  - [x] 14.1 Wire Focus_Signal from Leaderboard and Feed venues
    - Tapping venue name in Leaderboard (venue streak callout) -> `setFocusNodeId` -> map flies to venue
    - Tapping venue in feed item or archetype cluster -> same Focus_Signal mechanism
    - Reuse existing `focusNodeId` from `mapStore` - no new navigation pattern
    - _Requirements: 12.1, 12.2, 10.2.2, 11.2.2, 11.3.4, 11.4.3_

  - [x] 14.2 Implement deep-link URLs in share cards
    - Share cards include a deep-link URL pointing to the app (or web landing page for install prompt)
    - _Requirements: 12.3_

  - [x] 14.3 Ensure privacy guard integration across all new surfaces
    - Feed and leaderboard pass through existing `filterByPrivacy` guard
    - Non-mutual users: only `public` privacy-level check-ins appear
    - `friends_only` users: only appear to mutual friends
    - `private` users: never appear in others' feeds/leaderboard callouts
    - Fails closed on DynamoDB timeout - excluded users stay excluded
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]\* 14.4 Write integration tests for privacy filtering
    - Test public/friends_only/private users filtered correctly in feed
    - Test leaderboard privacy-gated venue callouts
    - Test archetype cluster respects privacy levels
    - _Requirements: 13.2, 13.3_

- [x] 15. Update existing property tests and final wiring
  - [x] 15.1 Update existing `carouselRanking.test.ts` property tests for new signal order
    - Update Properties 8-11 to use the extended `RankInput` interface (provide default values for new fields)
    - Old "buzz then distance then id" properties are superseded by the new lexicographic tests
    - Ensure `scopeToViewport` tests remain unchanged
    - _Requirements: 7.3_

  - [x] 15.2 Wire `hasLiveGets` derivation from rewards-near-me response into `mapStore`
    - GAP: today `/v1/rewards/near-me` is only fetched in `RewardsScreen.tsx`; the Map_Screen / carousel never fetches it, so `hasLiveGets` would always be empty and the priority-4 live-gets signal would be dead during browse. Add a rewards-near-me fetch on the map screen (reuse the same React Query key `['rewards','near-me',lat,lng]` so it is shared/deduped, not a second network call) gated by `positionFresh`
    - When that data arrives, call `deriveHasLiveGets` and `setHasLiveGets`
    - The signal degrades gracefully to `false` (no effect) if the fetch is absent, but without this wiring R5 / Property 5 have no observable effect on ranking
    - _Requirements: 5.1, 5.2_

  - [x] 15.3 Wire extended `RankInput` into PeekCarousel ranking call
    - Pass `consumerArchetypeId` (from the consumer auth/profile store), `venueArchetypeIds` (`mapStore.archetypeIds`), `friendsAtVenue`, and `hasLiveGets` from stores into `vibeRank`
    - Tier and default archetype are NOT passed as maps; the comparator reads them off each `Node` (`node.businessTier`, `node.defaultArchetypeId`) - confirm `vibeRank` imports `TIER_SIZE_MULTIPLIER`
    - _Requirements: 1.1 through 1.8, 7.1, 7.2_

- [x] 16. Final checkpoint - All systems integrated
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout - all implementations use TypeScript
- All new data stays in `AppData_Table` (PAY_PER_REQUEST) per the serverless-only steering rule
- Friends presence is event-driven (socket + session seed) - no polling (R14.1)
- Share cards generated client-side - no new Lambda for image rendering (R14.4)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.4", "2.5"] },
    { "id": 3, "tasks": ["4.1", "4.3", "5.1", "7.1"] },
    { "id": 4, "tasks": ["4.2", "4.4", "5.2", "7.2"] },
    { "id": 5, "tasks": ["5.3", "5.4", "7.3", "7.4", "8.1"] },
    { "id": 6, "tasks": ["7.5", "7.6", "8.2"] },
    { "id": 7, "tasks": ["8.3", "10.1", "11.1", "11.2", "12.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "11.3", "11.4", "11.5", "12.2"] },
    { "id": 9, "tasks": ["11.6", "12.3", "14.1", "14.2"] },
    { "id": 10, "tasks": ["14.3", "14.4", "15.1", "15.2"] },
    { "id": 11, "tasks": ["15.3"] }
  ]
}
```
