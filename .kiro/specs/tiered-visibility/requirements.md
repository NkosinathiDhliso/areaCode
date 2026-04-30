# Requirements Document

## Introduction

Area Code's identity model is simple: your name is only visible to your friends (mutual follows). If you're not on someone's friends list, you can't see who is truly at a venue — you just see how many people checked in and what kind of crowd is there (tier mix, and in future, music taste). This is not a toggle or a setting the user chooses between — it's how the platform works. Every check-in always fully contributes to the node: pulse score, live count, business analytics, crowd metadata, and map energy. The business always benefits from every visitor. Identity is protected by default.

## Glossary

- **Friends_List**: The set of Mutual_Follows for a given user. Only users on this list can see the user's name across any surface.
- **Mutual_Follow**: A relationship where User A follows User B AND User B follows User A, determined via the `user_follows` table. This defines the Friends_List.
- **Anonymised_Display**: The default view for non-friends — shows only the check-in count and Crowd_Metadata (tier mix, and in future music taste). No displayName, username, avatar, or initials are exposed.
- **Crowd_Metadata**: Anonymised aggregate data about the people at a node — total check-in count, tier distribution, and (future) music taste. Always visible to everyone.
- **Tier_Badge**: The visual indicator of a user's tier level (local, regular, fixture, institution, legend). Part of Crowd_Metadata visible to all.
- **Pulse_Score**: The real-time popularity metric for a node, stored in Redis sorted sets. Always updated on every check-in — platform invariant.
- **Live_Count_Badge**: The numeric count of recent check-ins displayed on a node marker. Always incremented on every check-in — platform invariant.
- **Activity_Feed**: The chronological list of check-in events from followed users, served by `GET /v1/feed`.
- **Leaderboard**: The weekly ranked list of users by check-in count per city, served by `GET /v1/leaderboard/{citySlug}`.
- **Who_Is_Here**: The section on a node detail sheet showing who recently checked in. Friends see names; non-friends see count + crowd type only.
- **Toast**: A real-time notification broadcast via Socket.io when a check-in occurs.
- **City_Room**: The Socket.io room scoped to a city slug (e.g. `city:johannesburg`).
- **User_Room**: The Socket.io room scoped to a single user (e.g. `user:{userId}`) for private notifications.
- **Business_Live_Panel**: The real-time dashboard panel in the business app showing check-in counts and crowd data.
- **Audience_Panel**: The business analytics panel showing anonymised aggregate data.
- **Consent_Cache**: The Redis key `user:consent:{userId}` with TTL of 3600 seconds.
- **Check_In_System**: The backend service (`check-in/service.ts`) that processes check-ins.
- **Safety_System**: The existing safety subsystem (Requirement 44) responsible for anti-stalking protections.

## Requirements

### Requirement 1: Platform Invariant — Every Check-In Fully Contributes

**User Story:** As a business owner, I want every single check-in to fully contribute to my venue's pulse score, live count, map energy, and crowd analytics, so that my node always reflects the real activity.

#### Acceptance Criteria

1. THE Check_In_System SHALL update the Pulse_Score for the checked-in node on every check-in. No user relationship or setting can suppress this.
2. THE Check_In_System SHALL increment the Live_Count_Badge on the node on every check-in.
3. THE Check_In_System SHALL increment the `checkin:today:{nodeId}` Redis counter on every check-in.
4. THE Check_In_System SHALL add the user to the `node:unique_users:{nodeId}` Redis set on every check-in.
5. THE Check_In_System SHALL emit the `node:pulse_update` socket event to the City_Room on every check-in.
6. THE Check_In_System SHALL emit the `business:checkin` socket event to the Business_Live_Panel on every check-in at a business-owned node.
7. THE Audience_Panel SHALL include every check-in in its anonymised aggregate calculations (tier distribution, repeat vs new visitors, Crowd_Metadata).
8. THE Check_In_System SHALL emit a Toast to the City_Room on every check-in. The toast never contains the user's name — it shows the node name and check-in count only (e.g. "Truth Coffee is heating up — 23 check-ins").

### Requirement 2: Names Visible Only to Friends

**User Story:** As a consumer, I want only my mutual follows to see my name anywhere on the platform, so that strangers and creeps can never identify me at a venue.

#### Acceptance Criteria

1. THE Who_Is_Here SHALL display the user's avatar, displayName, and Tier_Badge only to viewers who are on the user's Friends_List (Mutual_Follows).
2. THE Who_Is_Here SHALL display only the total check-in count and Crowd_Metadata (tier distribution) to viewers who are not on the user's Friends_List.
3. THE Activity_Feed SHALL display the user's full displayName, username, avatarUrl, and Tier_Badge only to viewers who are on the user's Friends_List.
4. THE Activity_Feed SHALL not display any individually identifiable entry for the user to viewers who are not on the user's Friends_List.
5. THE Leaderboard SHALL display the user's full displayName only to viewers who are on the user's Friends_List.
6. THE Leaderboard SHALL display Anonymised_Display (Tier_Badge only, no name) to viewers who are not on the user's Friends_List.
7. THIS is the default platform behavior — there is no setting to toggle. Names are always friends-only.

### Requirement 3: Non-Friends See the Vibe, Not the People

**User Story:** As a consumer browsing the map, I want to see what kind of crowd is at a venue and how many people are there, so that I can decide if it's my scene — even though I can't see specific names.

#### Acceptance Criteria

1. THE Who_Is_Here SHALL always display the total count of people checked in at a node to all viewers, regardless of friend status.
2. THE Who_Is_Here SHALL always display the tier composition line (e.g. "Mostly Fixtures and Institutions") to all viewers.
3. THE Node_Detail_Sheet SHALL always display Crowd_Metadata to all viewers including anonymous users.
4. THE Crowd_Metadata SHALL include tier distribution and check-in count. In future iterations, it will also include music taste data (with user consent).
5. THE Business_Live_Panel SHALL always display the full check-in count and Crowd_Metadata — no individual user names or avatars are exposed to the business.

### Requirement 4: Toast Messages — No Names, Just Energy

**User Story:** As a consumer on the map, I want to see that a venue is getting busy without knowing exactly who is there, so that the map feels alive without compromising anyone's identity.

#### Acceptance Criteria

1. THE Check_In_System SHALL emit Toasts to the City_Room that never contain any user's displayName or username.
2. THE Toast content SHALL reference the node and activity level only (e.g. "Truth Coffee is heating up", "23 people at Kitchener's right now").
3. THE Check_In_System SHALL emit a personalised Toast to the User_Room of each online Mutual_Follow when a friend checks in, containing the friend's displayName and the node name (e.g. "Sipho just checked in at Truth Coffee").
4. THE personalised friend Toast SHALL only be delivered via the User_Room — never broadcast to the City_Room.

### Requirement 5: Mutual Follow Resolution

**User Story:** As a developer, I want a reliable and performant way to determine mutual follow status, so that the friends-only identity rules can be enforced consistently across all surfaces.

#### Acceptance Criteria

1. THE platform SHALL determine Mutual_Follow status by checking that a row exists in `user_follows` where `follower_id = A AND following_id = B` AND a row exists where `follower_id = B AND following_id = A`.
2. THE platform SHALL resolve Mutual_Follow status for a batch of user IDs in a single database query when rendering the Activity_Feed, Leaderboard, or Who_Is_Here, to avoid N+1 query patterns.
3. IF the Mutual_Follow lookup fails due to a database error, THEN THE platform SHALL fall back to Anonymised_Display for the affected users, treating the failure as a non-friend state.

### Requirement 6: Remove the Privacy Toggle

**User Story:** As a platform operator, I want to remove the binary broadcast_location toggle from the profile screen, since name visibility is now a platform-level rule, not a user choice.

#### Acceptance Criteria

1. THE Profile screen SHALL remove the current "Show my activity on the map" boolean toggle from the Privacy section.
2. THE Profile screen SHALL display a brief explanation in the Privacy section: "Your name is only visible to people you both follow. Everyone else sees the vibe, not who."
3. THE Sign-up consent screen SHALL remove the "Show my activity on the map" toggle and replace it with a non-interactive explanation of the friends-only identity model.
4. THE `broadcast_location` boolean field in `consent_records` SHALL be deprecated. New consent records no longer write this field.

### Requirement 7: Backward-Compatible Migration

**User Story:** As a platform operator, I want existing consent records handled gracefully, so that the transition to friends-only identity is seamless.

#### Acceptance Criteria

1. THE platform SHALL ignore the `broadcast_location` value in existing `consent_records` rows — the friends-only rule applies universally regardless of historical consent values.
2. THE platform SHALL preserve all existing `consent_records` rows during migration — no rows are deleted.
3. THE Consent_Cache in Redis SHALL be invalidated after deployment, forcing fresh reads that apply the new friends-only logic.
4. THE `consentBodySchema` SHALL no longer require or accept the `broadcastLocation` field. The API SHALL return HTTP 400 if the deprecated field is sent after the transition period.

### Requirement 8: API and Type Updates

**User Story:** As a developer, I want the shared types and API schemas updated to reflect the new identity model, so that the frontend and backend stay in sync.

#### Acceptance Criteria

1. THE `ConsentRecord` TypeScript interface in `packages/shared/types/index.ts` SHALL remove the `broadcastLocation` field.
2. THE `consentBodySchema` in `backend/src/features/auth/types.ts` SHALL remove the `broadcastLocation` field.
3. THE `LeaderboardEntry` TypeScript interface SHALL include an `isFriend` boolean field, indicating whether the viewer has a Mutual_Follow relationship with the entry's user — the frontend uses this to decide whether to render the name or anonymised display.
4. THE `getUserConsent()` function SHALL no longer return a `broadcast_location` value. Any code referencing it SHALL be updated to use the friends-only identity logic directly.

### Requirement 9: Correctness Properties

**User Story:** As a platform operator, I want provable correctness guarantees, so that identity leaks are structurally impossible and business value is never compromised.

#### Acceptance Criteria

1. FOR ALL check-ins, THE Check_In_System SHALL update the Pulse_Score, increment the Live_Count_Badge, and include the check-in in business analytics. Nothing can suppress activity contribution.
2. FOR ALL users, THE platform SHALL ensure the user's displayName is never included in any API response, socket event payload, or rendered UI element visible to a non-Mutual_Follow viewer.
3. FOR ALL users, THE platform SHALL ensure the user's displayName is always included in API responses and socket event payloads delivered to Mutual_Follow viewers.
4. FOR ALL Toasts emitted to the City_Room, THE platform SHALL ensure no user displayName or username is included in the payload.
5. FOR ALL users, applying the friends-only identity filter twice to the same dataset SHALL produce the same result as applying it once (idempotence).
6. FOR ALL check-ins, a Toast SHALL be emitted to the City_Room — the content references the node and activity level only, never a user's identity.
