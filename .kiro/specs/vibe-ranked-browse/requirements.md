# Requirements: Vibe-Ranked Browse

## Introduction

The Peek_Carousel's Browse_Mode ranks venues so consumers are pulled toward
places that are alive, match their taste, and have their people - never toward
whatever is merely closest. Today the ranking is a simple aliveness-first sort
with proximity as a tiebreaker. This spec replaces that with a richer
lexicographic ranking that adds taste-match (archetype + friends), business
boost/tier, and live gets as signals, and introduces a "Top 2 + More" entry
point so the consumer sees the platform's best recommendation immediately
before opting into a full mindless browse.

The same discovery DNA then extends to two existing surfaces. City Ranks
(Requirement 10) evolves the flat LeaderboardScreen into archetype-segmented,
shareable ranks. City Feed (Requirement 11) evolves the flat FeedScreen into a
vibe-enriched, "Join them?"-driven, shareable activity feed. Requirements 12-14
cover cross-surface integration, privacy / honest-presence compliance, and the
serverless performance constraints these surfaces must hold to.

#[[.kiro/steering/discovery-dna-vibe-over-convenience.md]] #[[.kiro/steering/honest-presence.md]] #[[apps/web/src/lib/carouselRanking.ts]]

---

## Requirement 1: Lexicographic Ranking Order

The `vibeRank` function SHALL rank venues using the following signals in strict
lexicographic (short-circuit) order. A higher-ranked signal always beats all
signals below it: there is no additive blending ACROSS priority levels (proximity
can never be summed with vibe to outrank it). Individual signals MAY themselves be
composite scores (taste-match = archetype + friends per R2; aliveness = pulse +
check-ins); that internal compositing happens before the lexicographic comparison
and never lets a lower priority leak upward.

| Priority | Signal                         | Description                                                                                                                 | Higher wins?             |
| -------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1        | **Taste-match score**          | Composite of archetype match + friends-at-venue (see R2)                                                                    | Yes                      |
| 2        | **Aliveness**                  | `pulseScores[id] + checkInCounts[id]` (same as today)                                                                       | Yes                      |
| 3        | **Business tier (node boost)** | Numeric rank derived from `node.businessTier` via `TIER_SIZE_MULTIPLIER` (free/starter/payg = 1.0, growth = 1.3, pro = 1.6) | Yes                      |
| 4        | **Has live gets**              | Boolean: venue has >= 1 live event or offer get (per `classifyLifecycle`)                                                   | Yes (true > false)       |
| 5        | **Distance**                   | Haversine metres from `lastKnownPosition` (only when `positionFresh`)                                                       | No (nearer wins)         |
| 6        | **Venue ID**                   | String ascending                                                                                                            | Deterministic tiebreaker |

### Acceptance Criteria

1.1. A venue with a higher taste-match score SHALL always outrank one with a lower taste-match score, regardless of aliveness, tier, gets, or distance.

1.2. Between venues of equal taste-match, a venue with higher aliveness SHALL always outrank one with lower aliveness.

1.3. Between venues of equal taste-match AND equal aliveness, a venue with a higher business tier SHALL outrank one with a lower tier.

1.4. Between venues of equal taste-match, aliveness, AND tier, a venue with at least one live get SHALL outrank one without.

1.5. Between venues of equal taste-match, aliveness, tier, AND live-gets, a nearer venue SHALL outrank a farther one (only when position is fresh).

1.6. When `positionFresh` is false or `lastKnownPosition` is null, the distance signal SHALL be skipped (not treated as zero distance).

1.7. The final tiebreaker SHALL be venue ID ascending, ensuring total deterministic ordering.

1.8. The ranking function SHALL remain pure (no I/O, no Date.now inside the sort, clock injected from outside) so it can be property-tested exhaustively.

---

## Requirement 2: Taste-Match Score

The taste-match score is a composite signal combining archetype affinity and
social presence (friends). It produces a numeric score per venue so that the
lexicographic sort can compare venues at priority 1.

### 2.1 Archetype Match (binary)

Compare the consumer's `user.archetypeId` to the venue's resolved live
archetype (`mapStore.archetypeIds[nodeId]`, falling back to
`node.defaultArchetypeId`, then `'archetype-eclectic'`).

- **Match**: consumer archetype === venue archetype -> contributes **1 point**
- **No match** (or consumer has no archetypeId): contributes **0 points**

### 2.2 Friends-at-Venue

Count how many of the consumer's mutual friends are currently checked in at
the venue (honest presence - they must have an active, non-expired check-in).

- Each friend present contributes **1 point** to the taste-match score.
- When the consumer is unauthenticated or has no friends, this contributes 0.

### 2.3 Composite Score

```
tasteMatchScore(venue) = archetypeMatch(venue) + friendsAtVenue(venue)
```

### Acceptance Criteria

2.4. A venue where the consumer's archetype matches AND 2 friends are present (score = 3) SHALL outrank a venue where only the archetype matches and 0 friends are present (score = 1).

2.5. A venue with 3 friends present but no archetype match (score = 3) SHALL rank equally to a venue with archetype match + 2 friends (score = 3); the next signal (aliveness) breaks the tie.

2.6. When the consumer has no `archetypeId` set, archetype match SHALL contribute 0 for all venues (never penalise, never bonus).

2.7. When the consumer is unauthenticated, friends-at-venue SHALL contribute 0 for all venues.

2.8. Friends-at-venue SHALL only count friends with **active, non-expired** check-ins (honest presence rule - a friend who checked in 4 hours ago and whose presence expired does not count).

---

## Requirement 3: Friends Presence Store

A new client-side store (`friendsPresenceStore` or an extension of `mapStore`)
SHALL track which of the consumer's mutual friends are currently at which
venue.

### 3.1 Data Source

- Seeded from a lightweight API call on session start (`GET /v1/friends/presence`) that returns `{ items: Array<{ nodeId, userId, expiresAt }> }` for currently-present mutual friends. The client runs `filterActiveFriends(items, now)` on the seed so honest presence is enforced client-side as well as server-side.
- Updated in real-time via the existing `toast:friend_checkin` socket event. NOTE: that event's current payload is `{ type, message, nodeId?, avatarUrl? }` - it carries neither `userId` nor a guaranteed `nodeId`. The store is keyed `nodeId -> userId[]`, so it cannot be maintained from the current payload. This spec REQUIRES extending the `toast:friend_checkin` payload (and `ServerToClientEvents`) with a required `userId` and a required `nodeId`, and emitting them from the backend. See Design section 5 and task 4.3.
- Removal is event-driven only: the server emits `friend:checkout` (`{ userId, nodeId }`) when a friend checks out OR their presence expires (the server already tracks `expiresAt`). The client does NOT run its own expiry timers - the store shape (`nodeId -> userId[]`) holds no per-entry expiry, so client-side self-expiry is out of scope. On socket reconnect the client re-seeds from the API to recover any missed checkouts.

### 3.2 Shape

```typescript
// nodeId -> userId[]  (an array, deduplicated on insert so a repeated
// toast:friend_checkin for the same friend never double-counts taste-match)
friendsAtVenue: Record<string, string[]>
```

### Acceptance Criteria

3.3. The store SHALL be empty (all counts = 0) when the user is unauthenticated.

3.4. The store SHALL update within one render cycle of receiving a `toast:friend_checkin` or `friend:checkout` event.

3.5. A friend whose presence has expired SHALL be removed from the store (honest presence - never show stale friend presence).

3.6. The ranking function SHALL read `friendsAtVenue[nodeId].length` (or 0 when absent) for its friends-at-venue count.

---

## Requirement 4: Top 2 + More Entry Point

When the Peek_Carousel opens in Browse_Mode, it SHALL present a curated
"top 2" view before the full list.

### Acceptance Criteria

4.1. On carousel open (first paint, filter change, or re-open), the Browse_Mode strip SHALL show exactly the **top 2** venues from the ranked `carouselOrder`.

4.2. A third card/element in the strip SHALL render a **"More"** affordance (e.g. "Keep exploring" card, or a labelled button) indicating more venues are available.

4.3. Tapping "More" SHALL unlock the full `carouselOrder` - the strip expands to show all ranked venues, and the FlickControls / swipe step through the entire list (wrapping at ends).

4.4. Once "More" is tapped, it SHALL remain unlocked until the carousel is dismissed OR a `Category_Filter` change occurs (which resets to the top 2 view with the new filter's results).

4.5. If the ranked `carouselOrder` contains fewer than 3 venues, the "More" affordance SHALL NOT be shown (the full list is already visible).

4.6. The "More" affordance SHALL be keyboard-operable (focusable, Enter/Space activates) and carry an accessible label, consistent with the carousel accessibility rules established in the map-discovery-experience spec.

4.7. The map SHALL still snap/fly to the Active_Venue when stepping through the top 2, exactly as it does in the full browse.

---

## Requirement 5: Live Gets Signal

The ranking function needs to know whether a venue has at least one live
event or offer get.

### 5.1 Data Source

The `getRewardsNearMe` response already returns rewards annotated with
`getCategory` and lifecycle fields. Alternatively, a lightweight boolean
per node can be derived from the existing rewards data on the map.

### 5.2 Implementation Options (pick one during design)

- Option A: Extend `mapStore` with a `hasLiveGets: Record<string, boolean>` populated from the rewards-near-me response.
- Option B: Derive it at ranking time from the already-fetched rewards data if it's accessible per-node.

### Acceptance Criteria

5.3. A venue with `hasLiveGets = true` SHALL outrank one with `hasLiveGets = false` when taste-match, aliveness, and tier are all equal.

5.4. The live-gets signal SHALL remain a **tiebreaker** (priority 4), never capable of outranking a more-alive or better-taste-matched venue (Discovery DNA). A paid get does not buy rank above genuine vibe or taste.

5.5. The live-gets boolean SHALL only be true for genuinely live events/offers (lifecycle = 'live'), not upcoming or ended ones.

---

## Requirement 6: Map Camera Behaviour (unchanged)

6.1. WHEN the Active_Venue changes (via step, swipe, "More" unlock, or marker tap), the map SHALL fly/snap to the new Active_Venue's coordinates with the Sheet_Focus_Offset.

6.2. Reduced-motion users SHALL receive a zero-duration jump (no animation).

6.3. The camera behaviour is identical whether the user is in the top-2 view or the full browse view.

---

## Requirement 7: Backwards Compatibility

7.1. When the consumer has no `archetypeId`, no friends, and no position, the ranking SHALL degrade gracefully to aliveness -> tier -> live-gets -> venue-id (the best available signals).

7.2. Unauthenticated consumers SHALL see a ranking driven by aliveness, tier, live-gets, and distance only (taste-match = 0 for all venues).

7.3. Existing property tests for `vibeRank` SHALL be updated to cover the new signal order (the old "buzz then distance then id" properties are superseded).

---

## Requirement 8: Discovery DNA Compliance

8.1. Proximity SHALL NEVER be capable of outranking a venue with higher taste-match, higher aliveness, higher tier, or live gets. This is structurally enforced by the lexicographic order.

8.2. Business tier/boost is the "paid lever" - it gives paying venues an edge among equally-alive venues but can never buy dominance over genuine vibe or taste.

8.3. The ranking SHALL NOT introduce any "sort by nearest" mode or proximity-first path.

---

## Requirement 9: Future Extension Points (documented, not built)

9.1. **Taste-match enrichment**: The archetype-match component may evolve from binary (same/different) to a continuous similarity score based on dimension-score distance. The ranking stays lexicographic; only the score computation changes.

9.2. **Belonging magnet**: Friends-at-venue may gain a multiplier ("your best friend" vs "acquaintance") or integrate with the crowd-archetype-percentages signal.

9.3. **Momentum**: "Filling up fast" could combine with aliveness for a momentum-adjusted buzz score.

These are recorded for future specs. The current implementation uses the simple composite described in R2.

---

## Requirement 10: City Ranks (Leaderboard Evolution)

The existing LeaderboardScreen shows a flat weekly check-in count list. It
SHALL evolve into an archetype-flavoured, shareable, marketing-ready surface
that reinforces the discovery loop: see friends/locals thriving -> feel pull ->
go there -> check in -> appear on others' ranks.

### 10.1 Archetype-Segmented Ranks

**User Story:** As a consumer, I want to see my rank within my archetype tribe
so I feel personal competition and belonging, not just comparison to the whole
city.

#### Acceptance Criteria

10.1.1. The City Ranks screen SHALL show the consumer's rank within their
archetype (e.g. "Top Nomads this week in Joburg") as the primary/default view.

10.1.2. A secondary toggle/tab SHALL allow switching to the city-wide
leaderboard (all archetypes combined) for overall competitive context.

10.1.3. When the consumer has no `archetypeId`, the screen SHALL default to the
city-wide view and show a prompt to complete music preferences to unlock
archetype ranks.

10.1.4. Each entry in the archetype rank SHALL show: rank position, avatar (if
friend) or tier badge (if anonymous), display name (if friend) or "Anonymous
Explorer", tier badge, and weekly check-in count.

### 10.2 Venue Streak Callouts

**User Story:** As a consumer, I want to see which venue each top-ranked person
frequents most so I discover alive spots through social proof.

#### Acceptance Criteria

10.2.1. Each ranked entry SHALL show the name (or icon) of the venue where that
person checked in most during the current leaderboard period. In a tie (two or
more venues with the same check-in count), the most recently visited of the tied
venues SHALL be shown.

10.2.2. Tapping the venue callout SHALL trigger a Focus_Signal that flies the
map to that venue (reusing the existing `focusNodeId` mechanism).

10.2.3. The venue callout SHALL only show venues where the ranked user's
privacy settings allow visibility (respect POPIA / privacy-level checks).

### 10.3 Share Affordance

**User Story:** As a consumer, I want to share my rank as a screenshot-ready
card to my socials so my friends see I'm active and get curious about the app.

#### Acceptance Criteria

10.3.1. A "Share" button SHALL appear on the consumer's own rank card (whether
pinned at bottom or inline in the list).

10.3.2. Tapping "Share" SHALL generate a shareable card/image containing: the
consumer's rank, archetype glyph + name, tier badge, weekly check-in count,
and the top venue they powered that week.

10.3.3. The share card SHALL use the Web Share API (`navigator.share`) when
available, falling back to clipboard copy of a text summary with a link.

10.3.4. The share card SHALL NOT expose other users' personal data - only the
consumer's own stats.

### 10.4 Tier Progression Nudge

**User Story:** As a consumer, I want to see how far I am from my next tier so
I feel motivated to keep checking in.

#### Acceptance Criteria

10.4.1. The consumer's rank card SHALL display a compact tier progress
indicator showing check-ins to next tier (e.g. "7 more to Fixture").

10.4.2. When the consumer is at the highest tier (Legend), the indicator SHALL
show a celebratory label (e.g. "Legend | top of the city") instead of a
next-tier count.

---

## Requirement 11: City Feed (Activity Feed Evolution)

The existing FeedScreen shows a flat "X checked in to Y" timeline. It SHALL
evolve into a vibe-enriched, action-driving, shareable surface that markets
venues through friend activity and creates FOMO-pull toward alive spots.

### 11.1 Vibe-Enriched Feed Items

**User Story:** As a consumer, I want to see what the vibe is like at the
venues my friends checked into so I can judge whether to go there now.

#### Acceptance Criteria

11.1.1. Each feed item SHALL show: user avatar + name, venue name, relative
time, AND the venue's current pulse state (e.g. "buzzing"), live check-in
count, and archetype glyph/name - enriching the "what's happening" context.

11.1.2. Feed items for venues currently in `popping` or `buzzing` state SHALL
carry a visual accent (e.g. a coloured pulse-state badge or border glow) to
draw the eye to alive spots.

11.1.3. The venue vibe data SHALL be honest and current - if the pulse state
has dropped since the friend checked in, show the current state, not the
state at check-in time (honest-presence rule).

### 11.2 "Join Them" CTA

**User Story:** As a consumer, when I see a friend at an alive venue, I want a
one-tap path to that venue on the map so I can decide to go without friction.

#### Acceptance Criteria

11.2.1. Feed items where the friend is **still currently present** (active,
non-expired check-in) at a venue in `active`, `buzzing`, or `popping` state
SHALL render an inline "Join them?" action button.

11.2.2. Tapping "Join them?" SHALL trigger a Focus_Signal to that venue (fly
the map there, open the carousel on it) and navigate the user to Map_Screen.

11.2.3. Feed items where the friend's presence has expired, or the venue is now
`dormant`/`quiet`, SHALL NOT show the "Join them?" button (honest presence -
never send someone to a dead spot).

### 11.3 Archetype Clustering ("People like you")

**User Story:** As a consumer, I want the feed to surface activity from people
with my archetype so I see where my tribe is going.

#### Acceptance Criteria

11.3.1. When the consumer has an `archetypeId`, the feed SHALL include a
pinned section or top cluster showing recent check-ins from users who share
the same archetype (regardless of follow status).

11.3.2. This cluster SHALL be labelled with the consumer's archetype name
(e.g. "Nomads are at...") and show the top 3-5 most recent archetype-matched
check-ins.

11.3.3. Privacy-gated: only check-ins from users whose privacy level is
`public` SHALL appear in the archetype cluster (friends_only and private users
are excluded unless they are mutual friends).

11.3.4. Tapping an item in the cluster SHALL trigger a Focus_Signal to that
venue.

### 11.4 Live Gets in Feed

**User Story:** As a consumer, I want to know when venues near me drop live
events or offers so I don't miss out.

#### Acceptance Criteria

11.4.1. When a venue within the consumer's proximity radius drops a new live
event or offer get, a feed item SHALL be inserted showing the venue name, get
title, and a "Live now" badge.

11.4.2. This item SHALL only appear for venues within the existing
proximity-gated `getRewardsNearMe` radius (respects the proximity-gating
monetization invariant from the event-and-offer-gets spec, no free global
reach for events).

11.4.3. Tapping the item SHALL Focus_Signal to the venue on the map.

11.4.4. Expired gets (lifecycle = `ended`) SHALL NOT appear in the feed.

### 11.5 Shareable Milestones

**User Story:** As a consumer, I want the app to celebrate my achievements
(first check-in, tier ups, streaks) with shareable cards so I can flex to my
friends and market the app organically.

#### Acceptance Criteria

11.5.1. The feed SHALL auto-generate milestone entries for:

- First check-in at a new venue
- Tier advancement (e.g. "Moved up to Fixture!")
- Streak achievements (3-day, 7-day, 14-day, 30-day streaks)
- Leaderboard rank milestones (entering top 10, top 3, #1)

  11.5.2. Each milestone item SHALL include a "Share" button.

  11.5.3. Tapping "Share" SHALL produce a shareable card/image containing the
  milestone, the consumer's avatar, archetype glyph, and tier badge - formatted
  for Instagram/WhatsApp stories.

  11.5.4. The share card SHALL use Web Share API when available, with clipboard
  text + link as fallback.

  11.5.5. Milestone generation SHALL be idempotent - the same milestone is never
  duplicated in the feed.

### 11.6 Feed Ordering

11.6.1. The feed SHALL be ordered reverse-chronologically (most recent first)
with the archetype cluster pinned at the top when present.

11.6.2. The "Join them?" items (where friends are currently present at alive
venues) SHALL be promoted above standard chronological entries when they exist,
forming a "happening now" section.

---

## Requirement 12: Cross-Surface Integration

12.1. Tapping a venue name in the Leaderboard (venue streak callout) or Feed
SHALL trigger a Focus_Signal to that venue - same mechanism the Rewards screen
already uses, no new navigation pattern.

12.2. The City Ranks and City Feed screens SHALL remain accessible from the
existing tab/navigation structure - no new always-visible chrome.

12.3. Share cards generated from Ranks or Feed SHALL include a deep-link URL
pointing to the app (or a web landing page that prompts install) so external
viewers can discover Area Code.

---

## Requirement 13: Privacy and Honest Presence Compliance

13.1. The feed and leaderboard SHALL NEVER expose a user's precise location,
individual check-in history, or real-time coordinates. Only venue-level,
aggregate, and self-consented data is surfaced (POPIA compliance).

13.2. Feed items from non-mutual users SHALL only appear if their privacy level
is `public`. `friends_only` users only appear to their mutual friends.
`private` users never appear in others' feeds or leaderboard venue callouts.

13.3. The archetype cluster (R11.3) SHALL respect privacy-level gating: only
public check-ins from non-friends, plus check-ins from mutual friends
regardless of their privacy level.

13.4. All presence-related signals (friends-at-venue, "Join them?", live
counts on feed items) SHALL reflect honest current state. Stale data must
never be presented as current (honest-presence rule).

---

## Requirement 14: Performance and Constraints

14.1. The friends-presence store (R3) SHALL not poll - it is event-driven
(socket + session-start seed). No new periodic API calls.

14.2. The feed endpoint SHALL support cursor-based pagination (already does)
and add no N+1 queries for the enriched vibe data - venue pulse state and
count should be joined server-side or cached.

14.3. The leaderboard endpoint SHALL add the archetype-segment parameter
without breaking the existing city-wide response shape (additive, not
breaking).

14.4. Share card generation SHALL happen client-side (canvas/SVG to image) -
no new Lambda for image rendering. Keep it serverless-clean.

14.5. All new data stays in the existing `AppData_Table`
(`PAY_PER_REQUEST`). No new DynamoDB tables, no new GSIs unless strictly
required and explicitly justified.
