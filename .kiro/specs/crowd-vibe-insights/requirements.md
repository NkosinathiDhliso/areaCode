# Requirements Document

## Introduction

Crowd Vibe Insights derives personality archetypes from real music listening data (Spotify, Apple Music) and aggregates them into live crowd profiles per venue. Instead of self-reported genre picks, the system pulls actual top artists/tracks via streaming APIs, extracts genre tags, scores users across five personality dimensions (Energy, Cultural Rootedness, Sophistication, Edge, Spirituality), and resolves a single archetype from an admin-managed catalog of ~15 personality types. The feature surfaces in four places: consumer node detail sheet (crowd vibe breakdown), business audience panel (music taste analytics), user profile (streaming connection and personality badge), and admin panel (archetype catalog management and genre-dimension weight editor). Manual genre selection is the fallback when no streaming service is connected. All streaming data sharing requires explicit POPIA opt-in consent.

## Glossary

- **Crowd_Vibe_Engine**: The backend module that aggregates checked-in users' personality dimensions and archetype assignments at a node, producing genre counts, personality percentages, and the overall crowd vibe snapshot.
- **Music_Genre**: One of the 12 South African-relevant music genres: Amapiano, Deep House, Afrobeats, Hip Hop, R&B, Kwaito, Gqom, Jazz, Rock, Pop, Gospel, Maskandi.
- **Personality_Dimension**: One of the five scoring axes: Energy, Cultural_Rootedness, Sophistication, Edge, Spirituality. Each dimension is scored 0.0–1.0.
- **Dimension_Score_Vector**: A five-element numeric vector representing a user's scores across all Personality_Dimensions, computed from their genre weights.
- **Genre_Weight_Matrix**: An admin-editable lookup table mapping each Music_Genre to weighted contributions (0.0–1.0) across all five Personality_Dimensions.
- **Personality_Archetype**: A named personality type (e.g. "The Groove Seeker") stored in the database with dimension thresholds, priority, iconId (SVG icon identifier), and description. Managed by admins via CRUD operations.
- **Archetype_Resolver**: The function that takes a user's Dimension_Score_Vector and evaluates it against all active Personality_Archetypes' dimension thresholds, returning the highest-priority matching archetype.
- **Streaming_Connector**: The OAuth integration module that connects to Spotify Web API (`user-top-read` scope) or Apple Music MusicKit API to retrieve a user's top artists and tracks.
- **Listening_Data_Sync**: The background job that refreshes a connected user's top artists/tracks from their streaming service on a weekly schedule.
- **Crowd_Vibe_Snapshot**: A data object containing genre counts, personality archetype percentages, and total checked-in count for a given node.
- **Node_Detail_Sheet**: The consumer-facing bottom sheet component displayed when a user taps a venue on the map.
- **Audience_Panel**: The business-facing dashboard panel showing visitor analytics for a venue owner.
- **Profile_Screen**: The consumer-facing screen where users manage their account, connect streaming services, and view their personality archetype.
- **Admin_Panel**: The admin-facing dashboard where super admins manage archetype catalogs and genre-dimension weights.
- **Mock_Layer**: The existing dev-mode mock system that intercepts API calls and socket events with synthetic data.
- **POPIA_Consent**: The explicit user opt-in required under the Protection of Personal Information Act before any streaming listening data is accessed or stored.

## Requirements

### Requirement 1: Music Genre and Dimension Type Definitions

**User Story:** As a developer, I want music genre, personality dimension, and archetype type definitions in the shared type system, so that all apps reference a single source of truth.

#### Acceptance Criteria

1. THE shared type system SHALL define a `MusicGenre` union type containing exactly the 12 genres: Amapiano, Deep House, Afrobeats, Hip Hop, R&B, Kwaito, Gqom, Jazz, Rock, Pop, Gospel, Maskandi.
2. THE shared type system SHALL define a `PersonalityDimension` union type containing exactly the 5 dimensions: Energy, Cultural_Rootedness, Sophistication, Edge, Spirituality.
3. THE shared type system SHALL define a `DimensionScoreVector` type as a record mapping each PersonalityDimension to a number between 0.0 and 1.0.
4. THE shared type system SHALL define a `PersonalityArchetype` interface containing `id`, `name`, `iconId` (string identifier for SVG icon lookup — no emoji characters per CLAUDE.md Rule 5), `description`, `dimensionThresholds` (record of PersonalityDimension to minimum score), `priority` (number), and `isActive` (boolean).
5. THE shared type system SHALL define a `GenreWeightEntry` type mapping a Music_Genre to its weighted contributions across all five Personality_Dimensions.
6. THE `User` type SHALL include optional fields: `musicGenres` (MusicGenre[]), `dimensionScores` (DimensionScoreVector), `archetypeId` (string), and `streamingProvider` ('spotify' | 'apple_music' | null).

### Requirement 2: Spotify Streaming Integration

**User Story:** As a consumer, I want to connect my Spotify account, so that the platform uses my real listening data instead of manual genre picks.

#### Acceptance Criteria

1. THE Profile_Screen SHALL display a "Connect Spotify" button when the user has no streaming service connected.
2. WHEN a user taps "Connect Spotify", THE Streaming_Connector SHALL initiate an OAuth 2.0 authorization code flow with Spotify Web API requesting the `user-top-read` scope.
3. WHEN the OAuth callback is received with a valid authorization code, THE Streaming_Connector SHALL exchange the code for access and refresh tokens and store them encrypted in the database.
4. WHEN tokens are stored, THE Streaming_Connector SHALL fetch the user's top 50 artists from the Spotify `GET /v1/me/top/artists` endpoint with `time_range=medium_term`.
5. THE Streaming_Connector SHALL extract genre tags from each artist's `genres` array and map them to the closest matching Music_Genre values.
6. IF the OAuth flow fails or the user denies access, THEN THE Streaming_Connector SHALL display an error message and retain the user's previous state without data loss.
7. THE Profile_Screen SHALL display a "Disconnect Spotify" button when Spotify is connected, allowing the user to revoke access and delete stored tokens.

### Requirement 3: Apple Music Streaming Integration

**User Story:** As a consumer, I want to connect my Apple Music account as an alternative to Spotify, so that I can use my real listening data regardless of streaming platform.

#### Acceptance Criteria

1. THE Profile_Screen SHALL display a "Connect Apple Music" button when the user has no streaming service connected.
2. WHEN a user taps "Connect Apple Music", THE Streaming_Connector SHALL initiate the Apple Music MusicKit authorization flow to obtain a user token.
3. WHEN a valid user token is obtained, THE Streaming_Connector SHALL fetch the user's recently played tracks and heavy rotation content from the Apple Music API.
4. THE Streaming_Connector SHALL extract genre metadata from Apple Music catalog items and map them to the closest matching Music_Genre values.
5. IF the Apple Music authorization fails, THEN THE Streaming_Connector SHALL display an error message and retain the user's previous state.
6. THE Profile_Screen SHALL display a "Disconnect Apple Music" button when Apple Music is connected.

### Requirement 4: POPIA Consent for Listening Data

**User Story:** As a consumer, I want to explicitly opt in before my listening data is shared, so that my privacy is protected under POPIA.

#### Acceptance Criteria

1. WHEN a user initiates a streaming service connection, THE Profile_Screen SHALL display a consent dialog explaining what listening data is collected, how it is used, and that it is processed to derive music personality insights.
2. THE consent dialog SHALL require the user to actively confirm (tap "I Agree") before the OAuth flow begins.
3. WHEN the user grants consent, THE system SHALL create a POPIA_Consent record with the user ID, consent version, timestamp, and the specific data scope authorized.
4. WHEN the user declines consent, THE system SHALL cancel the streaming connection flow and not initiate any OAuth request.
5. THE Profile_Screen SHALL display the current consent status and allow the user to withdraw consent at any time, which triggers disconnection of the streaming service and deletion of stored listening data.
6. IF a user withdraws consent, THEN THE system SHALL delete all stored streaming tokens and extracted listening data within the same request.

### Requirement 5: Listening Data Weekly Refresh

**User Story:** As a consumer, I want my listening data to stay current, so that my personality archetype reflects my evolving music taste.

#### Acceptance Criteria

1. THE Listening_Data_Sync SHALL execute as a scheduled background job once per week for each user with a connected streaming service.
2. WHEN the sync job runs, THE Listening_Data_Sync SHALL fetch the user's current top artists from the connected streaming API and update the stored genre list.
3. WHEN the genre list changes, THE Listening_Data_Sync SHALL recompute the user's Dimension_Score_Vector and re-resolve the Personality_Archetype.
4. IF the stored refresh token is expired or revoked, THEN THE Listening_Data_Sync SHALL mark the streaming connection as disconnected and set the user's `streamingProvider` to null.
5. THE Listening_Data_Sync SHALL log each sync attempt with status (success, token_expired, api_error) for observability.

### Requirement 6: Manual Genre Fallback Selection

**User Story:** As a consumer without a streaming service, I want to manually select my favourite genres, so that I still get a personality archetype.

#### Acceptance Criteria

1. WHILE a user has no streaming service connected, THE Profile_Screen SHALL display a manual genre multi-select control listing all 12 Music_Genre options.
2. THE Profile_Screen SHALL allow a user to select between 1 and 5 music genres manually.
3. WHEN a user saves manual genre selections, THE Profile_Screen SHALL send a PATCH request to `/v1/users/me/genres` with the updated `musicGenres` array.
4. WHEN manual genres are saved, THE system SHALL compute the user's Dimension_Score_Vector from the Genre_Weight_Matrix and resolve the Personality_Archetype.
5. WHEN a user connects a streaming service, THE system SHALL replace manual genre selections with streaming-derived genres.
6. IF the PATCH request fails, THEN THE Profile_Screen SHALL display an error message and retain the previous selections.

### Requirement 7: Genre-to-Dimension Weight Matrix

**User Story:** As an admin, I want to manage the genre-to-dimension weight mappings, so that personality scoring can be tuned without code changes.

#### Acceptance Criteria

1. THE system SHALL store a Genre_Weight_Matrix in the database mapping each of the 12 Music_Genres to weighted scores (0.0–1.0) across all 5 Personality_Dimensions.
2. THE system SHALL seed the Genre_Weight_Matrix with the following initial values:
   - Amapiano: Energy 0.9, Cultural_Rootedness 0.6, Sophistication 0.3, Edge 0.2, Spirituality 0.1
   - Deep House: Energy 0.5, Cultural_Rootedness 0.2, Sophistication 0.8, Edge 0.1, Spirituality 0.3
   - Afrobeats: Energy 0.8, Cultural_Rootedness 0.7, Sophistication 0.3, Edge 0.3, Spirituality 0.2
   - Hip Hop: Energy 0.6, Cultural_Rootedness 0.4, Sophistication 0.4, Edge 0.8, Spirituality 0.2
   - R&B: Energy 0.4, Cultural_Rootedness 0.3, Sophistication 0.8, Edge 0.2, Spirituality 0.4
   - Kwaito: Energy 0.7, Cultural_Rootedness 0.9, Sophistication 0.2, Edge 0.5, Spirituality 0.3
   - Gqom: Energy 0.9, Cultural_Rootedness 0.5, Sophistication 0.1, Edge 0.8, Spirituality 0.1
   - Jazz: Energy 0.3, Cultural_Rootedness 0.3, Sophistication 0.9, Edge 0.2, Spirituality 0.7
   - Rock: Energy 0.8, Cultural_Rootedness 0.1, Sophistication 0.2, Edge 0.9, Spirituality 0.1
   - Pop: Energy 0.6, Cultural_Rootedness 0.2, Sophistication 0.4, Edge 0.3, Spirituality 0.2
   - Gospel: Energy 0.4, Cultural_Rootedness 0.7, Sophistication 0.4, Edge 0.1, Spirituality 0.9
   - Maskandi: Energy 0.5, Cultural_Rootedness 0.9, Sophistication 0.3, Edge 0.3, Spirituality 0.6
3. THE Admin_Panel SHALL display a genre-dimension weight matrix editor allowing admins to view and update weight values.
4. WHEN an admin updates a weight value, THE Admin_Panel SHALL validate that the value is between 0.0 and 1.0 before saving.
5. WHEN weight values are updated, THE system SHALL not retroactively recompute existing user scores until the next Listening_Data_Sync cycle or manual genre save.

### Requirement 8: Multi-Dimensional Personality Scoring

**User Story:** As a consumer, I want my personality to be scored across multiple dimensions, so that my archetype reflects the nuance of my music taste.

#### Acceptance Criteria

1. WHEN a user has one or more music genres, THE system SHALL compute a Dimension_Score_Vector by averaging the Genre_Weight_Matrix values across all of the user's genres for each dimension.
2. THE Dimension_Score_Vector SHALL contain a score between 0.0 and 1.0 for each of the 5 Personality_Dimensions.
3. WHEN a user has zero music genres and no streaming service connected, THE system SHALL assign a null Dimension_Score_Vector.
4. FOR ALL valid sets of music genres, computing the Dimension_Score_Vector and verifying each dimension score is the average of the corresponding genre weights SHALL produce consistent results (invariant property).

### Requirement 9: Admin-Managed Personality Archetype Catalog

**User Story:** As an admin, I want to manage personality archetypes in a database catalog, so that new archetypes can be added or tuned without code deployments.

#### Acceptance Criteria

1. THE system SHALL store Personality_Archetypes in a database table with fields: `id`, `name`, `iconId` (string identifier for SVG icon — no emoji characters), `description`, `dimensionThresholds` (JSON mapping each relevant dimension to a minimum score), `priority` (integer), and `isActive` (boolean).
2. THE system SHALL seed the catalog with the following 15 initial archetypes (listed with name, key dimension thresholds, and priority from highest to lowest):
   - The Festival Spirit: Energy >= 0.7, Cultural_Rootedness >= 0.6, Edge >= 0.4 (priority 15)
   - The Conscious Creative: Spirituality >= 0.4, Edge >= 0.4, Sophistication >= 0.4 (priority 14)
   - The Township Royal: Cultural_Rootedness >= 0.7, Energy >= 0.6, Edge >= 0.4 (priority 13)
   - The Sacred Rebel: Spirituality >= 0.6, Edge >= 0.6 (priority 12)
   - The Firecracker: Energy >= 0.7, Edge >= 0.6 (priority 11)
   - The Heritage Groover: Energy >= 0.7, Cultural_Rootedness >= 0.6 (priority 10)
   - The Midnight Philosopher: Sophistication >= 0.7, Spirituality >= 0.4 (priority 9)
   - The Street Poet: Edge >= 0.6, Cultural_Rootedness >= 0.4 (priority 8)
   - The Soul Wanderer: Spirituality >= 0.6, Sophistication >= 0.6 (priority 7)
   - The Vibe Architect: Sophistication >= 0.6, Energy >= 0.4 (priority 6)
   - The Smooth Operator: Sophistication >= 0.7, Energy < 0.5 (priority 5)
   - The Groove Seeker: Energy >= 0.7 (priority 4)
   - The Culture Curator: Cultural_Rootedness >= 0.7 (priority 3)
   - The Eclectic: no single dimension >= 0.7 (priority 2)
   - The Uncharted: fallback for users with no genre data (priority 1)
3. THE Admin_Panel SHALL display a list of all archetypes with their name, icon, dimension thresholds, priority, and active status.
4. THE Admin_Panel SHALL allow admins to add a new archetype with name, iconId, description, dimension thresholds, and priority.
5. THE Admin_Panel SHALL allow admins to edit an existing archetype's name, iconId, description, dimension thresholds, priority, and active status.
6. THE Admin_Panel SHALL allow admins to enable or disable an archetype by toggling the `isActive` field.
7. WHEN an archetype is disabled, THE Archetype_Resolver SHALL exclude the disabled archetype from matching.

### Requirement 10: Archetype Resolution Logic

**User Story:** As a consumer, I want to be assigned the most specific personality archetype that matches my dimension scores, so that my label feels accurate.

#### Acceptance Criteria

1. WHEN a user has a valid Dimension_Score_Vector, THE Archetype_Resolver SHALL evaluate the vector against all active Personality_Archetypes' dimension thresholds.
2. THE Archetype_Resolver SHALL consider an archetype as matching when the user's score meets or exceeds every dimension threshold defined for that archetype.
3. WHEN multiple archetypes match, THE Archetype_Resolver SHALL return the archetype with the highest priority value.
4. WHEN no archetype thresholds are met (excluding The Eclectic and The Uncharted), THE Archetype_Resolver SHALL return "The Eclectic".
5. WHEN a user has no genre data (null Dimension_Score_Vector), THE Archetype_Resolver SHALL return "The Uncharted".
6. FOR ALL valid Dimension_Score_Vectors, resolving the archetype SHALL return exactly one Personality_Archetype (determinism property).

### Requirement 11: Admin Archetype Test Tool

**User Story:** As an admin, I want to test a genre combination and see which archetype it resolves to, so that I can verify archetype thresholds before publishing changes.

#### Acceptance Criteria

1. THE Admin_Panel SHALL display a "Test Archetype" tool that accepts a set of Music_Genre selections as input.
2. WHEN an admin submits a genre combination, THE test tool SHALL compute the Dimension_Score_Vector from the current Genre_Weight_Matrix and display all five dimension scores.
3. THE test tool SHALL display the resolved Personality_Archetype name, icon, and description for the computed vector.
4. THE test tool SHALL list all matching archetypes in priority order, highlighting the winning archetype.
5. WHEN the genre combination is empty, THE test tool SHALL display "The Uncharted" as the resolved archetype.

### Requirement 12: Crowd Vibe Snapshot Computation

**User Story:** As a consumer, I want to see the music vibe of a venue, so that I can decide if the crowd matches my taste.

#### Acceptance Criteria

1. WHEN the Node_Detail_Sheet requests crowd data for a node, THE Crowd_Vibe_Engine SHALL compute a Crowd_Vibe_Snapshot from all currently checked-in users at that node.
2. THE Crowd_Vibe_Snapshot SHALL contain a genre count object mapping each Music_Genre present among checked-in users to its count.
3. THE Crowd_Vibe_Snapshot SHALL contain an archetype percentage object mapping each Personality_Archetype present among checked-in users to its percentage of the total crowd, rounded to the nearest whole number.
4. THE Crowd_Vibe_Snapshot archetype percentages SHALL sum to 100 (with rounding adjustment applied to the largest segment).
5. WHEN zero users are checked in at a node, THE Crowd_Vibe_Engine SHALL return an empty Crowd_Vibe_Snapshot with zero counts and zero percentages.
6. THE Crowd_Vibe_Snapshot SHALL include the aggregate Dimension_Score_Vector averaged across all checked-in users for radar chart display.

### Requirement 13: Consumer Node Detail Sheet — Crowd Vibe Display

**User Story:** As a consumer, I want to see the crowd vibe when I tap a venue, so that I know what kind of people are there right now.

#### Acceptance Criteria

1. THE Node_Detail_Sheet SHALL display a "Crowd Vibe" section below the existing rewards section.
2. THE Node_Detail_Sheet SHALL display an archetype breakdown showing each Personality_Archetype present with its icon and percentage (e.g. "65% Groove Seekers · 20% Vibe Architects · 15% Culture Curators").
3. THE Node_Detail_Sheet SHALL display a genre count summary showing each Music_Genre present and its count (e.g. "12 Amapiano · 8 Deep House · 5 Hip Hop").
4. THE Node_Detail_Sheet SHALL display checked-in users in the "Who's here" section with their archetype icon badge next to their name.
5. WHEN zero users with music preferences are checked in, THE Node_Detail_Sheet SHALL hide the Crowd Vibe section.

### Requirement 14: Business Audience Panel — Music Insights

**User Story:** As a venue owner, I want to see the music taste distribution of my visitors, so that I can tailor my venue's music and marketing.

#### Acceptance Criteria

1. THE Audience_Panel SHALL display a "Music Taste" card showing the distribution of Music_Genre selections across all visitors for the current period, sourced from real streaming data where available.
2. THE Audience_Panel SHALL display a "Personality Types" card showing the percentage breakdown of Personality_Archetypes among visitors with icon badges.
3. THE Audience_Panel SHALL display a "Peak Personality by Time" card showing which Personality_Archetype is most prevalent during each time segment (e.g. "Soul Wanderers peak at lunch, Groove Seekers take over after 8pm").
4. WHEN the venue has fewer than 20 unique visitors with music preferences, THE Audience_Panel SHALL display a minimum-data message instead of the music insight cards.

### Requirement 15: User Profile — Streaming and Personality Display

**User Story:** As a consumer, I want to see my derived personality archetype and connected streaming service in my profile, so that I understand how the platform sees my music taste.

#### Acceptance Criteria

1. THE Profile_Screen SHALL display the user's resolved Personality_Archetype with its icon, name, and description.
2. THE Profile_Screen SHALL display the user's top genres extracted from streaming data, ordered by frequency.
3. WHILE a streaming service is connected, THE Profile_Screen SHALL display the connected service name (Spotify or Apple Music) with a "Disconnect" option.
4. WHILE no streaming service is connected, THE Profile_Screen SHALL display both "Connect Spotify" and "Connect Apple Music" buttons above the manual genre fallback selector.
5. WHEN a user has the "Uncharted" archetype, THE Profile_Screen SHALL display a prompt encouraging the user to connect a streaming service or select genres manually.

### Requirement 16: Crowd Vibe API Endpoints

**User Story:** As a frontend developer, I want dedicated API endpoints for crowd vibe data, so that the consumer and business apps can fetch it independently.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/nodes/:nodeId/crowd-vibe`, THE API SHALL return the Crowd_Vibe_Snapshot for the specified node including `genreCounts`, `archetypePercentages`, `aggregateDimensionScores`, and `totalCheckedIn`.
2. WHEN a GET request is made to `/v1/business/me/audience/music`, THE API SHALL return the music taste distribution, archetype breakdown, and peak archetype by time data for the business's nodes.
3. WHEN a POST request is made to `/v1/users/me/streaming/connect` with provider and authorization code, THE API SHALL complete the OAuth token exchange and initiate the first listening data fetch.
4. WHEN a DELETE request is made to `/v1/users/me/streaming/disconnect`, THE API SHALL revoke stored tokens, delete listening data, and reset the user's streaming provider to null.
5. WHEN a GET request is made to `/v1/admin/archetypes`, THE API SHALL return all Personality_Archetypes ordered by priority descending.
6. WHEN a POST request is made to `/v1/admin/archetypes`, THE API SHALL create a new Personality_Archetype with the provided fields.
7. WHEN a PATCH request is made to `/v1/admin/archetypes/:id`, THE API SHALL update the specified archetype's fields.
8. WHEN a POST request is made to `/v1/admin/archetypes/test` with a `genres` array, THE API SHALL return the computed Dimension_Score_Vector, the resolved archetype, and all matching archetypes in priority order.
9. WHEN a GET request is made to `/v1/admin/genre-weights`, THE API SHALL return the full Genre_Weight_Matrix.
10. WHEN a PATCH request is made to `/v1/admin/genre-weights`, THE API SHALL update the specified genre-dimension weight entries.
11. IF a specified node does not exist, THEN THE API SHALL return a 404 error with a descriptive message.

### Requirement 17: Mock Data for Dev Mode

**User Story:** As a developer, I want comprehensive mock data for crowd vibe features, so that I can develop and test all surfaces without a live backend or streaming API credentials.

#### Acceptance Criteria

1. THE Mock_Layer SHALL assign between 2 and 4 random Music_Genre values to each mock user.
2. THE Mock_Layer SHALL compute a Dimension_Score_Vector and resolve a Personality_Archetype for each mock user based on their assigned genres.
3. THE Mock_Layer SHALL mock the Spotify OAuth flow to return instant success with synthetic tokens, bypassing real OAuth redirects.
4. THE Mock_Layer SHALL register a handler for `GET /v1/nodes/:nodeId/crowd-vibe` that returns a Crowd_Vibe_Snapshot with realistic archetype distributions per venue category: nightlife nodes skew toward Groove Seeker and Firecracker, coffee nodes skew toward Midnight Philosopher and Smooth Operator, arts nodes skew toward Soul Wanderer and Conscious Creative.
5. THE Mock_Layer SHALL register a handler for `GET /v1/business/me/audience/music` that returns mock music taste distribution, archetype breakdown, and peak archetype by time data.
6. THE Mock_Layer SHALL register handlers for all admin archetype CRUD endpoints and the genre-weight matrix endpoints returning seeded data.
7. THE Mock_Layer SHALL register a handler for `POST /v1/admin/archetypes/test` that computes and returns the dimension scores and resolved archetype for the submitted genre combination.
8. THE mock socket consumer emitter SHALL include `musicGenres`, `dimensionScores`, and `archetypeId` fields in check-in toast event payloads.
