# Requirements Document

## Introduction

Venue Live Signals replaces WebSocket-based real-time updates on the consumer web and mobile apps with a lightweight polling-based approach, and introduces Waze-style crowd-sourced venue signals that any authenticated user can report. V1 supports two signal types: the genre currently playing at a venue and the queue length. Signals are displayed as genre glyphs on map markers and as detail in the node sheet. A confidence model scores signals based on recency, report volume, reporter tier, GPS proximity, and contradictions. Users earn a "Reputation" stat for contributing signals. Venue owners can submit badged signals on their own venue and dispute crowd signals they believe are incorrect. When no live genre report exists, the map falls back to the existing aggregate crowd taste profile with a visual "predicted" indicator. The staff app retains its existing WebSocket infrastructure unchanged.

### V1 Launch Philosophy

V1 prioritises participation and engagement over strict anti-abuse enforcement. The goal is to grow the contributor base and make the feature feel alive. Anti-abuse thresholds are intentionally lenient to avoid punishing early adopters who may trigger false positives due to low report volume. These thresholds will be tightened in Phase 2 once the platform reaches critical mass (target: 500+ weekly active signal reporters per city).

**Phase 2 Hardening (post-launch):** Reduce daily signal cap from 50 → 20, raise contradiction flag threshold from 10 → 5, replace soft-ban (weight 0.1) with hard-ban (weight 0.0 + rejection), reduce correction window from 2 minutes → 0, raise display confidence threshold from 0.15 → 0.3.

## Glossary

- **Signal_API**: The Fastify API routes under `/v1/signals` that handle signal submission, retrieval, and dispute operations.
- **Polling_API**: The Fastify API route `GET /v1/pulse/city/:slug/delta` that returns node state changes since a given timestamp, replacing WebSocket subscriptions for consumer apps.
- **Signal**: A crowd-sourced report submitted by an authenticated user indicating the current genre playing or queue length at a specific venue (node).
- **Genre_Signal**: A Signal of type `genre_playing` containing one of the 12 SA genres (amapiano, deep_house, afrobeats, hip_hop, rnb, kwaito, gqom, jazz, rock, pop, gospel, maskandi).
- **Queue_Signal**: A Signal of type `queue_length` containing one of three chip values: `none`, `short`, or `long`.
- **Confidence_Score**: A computed value between 0.0 and 1.0 representing the reliability of a Signal, derived from recency, report count, reporter tier, proximity, and contradictions.
- **Signal_Aggregator**: The backend module that computes the consensus signal for a node by weighting individual reports using the Confidence_Score model.
- **Reputation**: A numeric stat on the user profile that increases when a user submits signals. Reputation is separate from check-in tier progress and does not inflate tier advancement.
- **Reporter_Weight**: A multiplier applied to a user's signal contribution based on their tier and historical accuracy. Higher-tier users and users with good track records receive higher weight.
- **Proximity_Report**: A Signal submitted by a user whose GPS coordinates are within 150 metres of the venue, receiving higher confidence weight.
- **Remote_Report**: A Signal submitted by a user who is not within 150 metres of the venue, receiving standard confidence weight.
- **Owner_Report**: A Signal submitted by the venue's business owner, visually badged as "Owner report" in the UI so consumers can distinguish it from crowd reports.
- **Signal_Dispute**: A flag raised by a venue owner against a crowd signal they believe is incorrect, triggering admin review.
- **Decay_Function**: The time-based reduction of Confidence_Score. Genre signals have a TTL of 60 minutes; queue signals have a TTL of 30 minutes.
- **Genre_Glyph**: A small icon displayed on map markers representing the currently reported genre at a venue.
- **Predicted_Indicator**: A visual cue (label and styling) shown when no live genre report exists and the displayed genre is derived from the aggregate crowd taste profile rather than a live report.
- **Consumer_App**: The React 18 web application (apps/web/) and mobile application (apps/mobile/) used by consumers.
- **Staff_App**: The React application (apps/staff/) used by venue staff, which retains WebSocket connectivity.
- **Delta_Response**: The JSON payload returned by the Polling_API containing node state changes (pulse updates, new signals, state surges) since the requested timestamp.
- **Admin_Review_Queue**: The admin dashboard interface where disputed signals are reviewed and resolved.
- **MusicGenre**: One of the 12 defined South African genres: amapiano, deep_house, afrobeats, hip_hop, rnb, kwaito, gqom, jazz, rock, pop, gospel, maskandi.

## Requirements

### Requirement 1: Consumer WebSocket Removal and Polling Replacement

**User Story:** As a consumer, I want the app to stay updated with venue activity without requiring a persistent WebSocket connection, so that the experience is reliable on unstable mobile networks.

#### Acceptance Criteria

1. THE Consumer_App SHALL remove all WebSocket subscription hooks (useNodePulse, useStateSurge, useRealtimeToast, useRewardSocket, useNodeCreated) from the consumer web and mobile applications.
2. WHILE the map view is visible, THE Consumer_App SHALL poll the Polling_API every 10 seconds to retrieve node state changes.
3. WHEN the user explicitly navigates away from the map view, THE Consumer_App SHALL stop polling until the map view becomes visible again. Polling SHALL continue when the app is minimized or the device screen is off, provided the map view remains the active screen.
4. THE Polling_API SHALL expose `GET /v1/pulse/city/:slug/delta?since=<timestamp>` accepting an ISO timestamp parameter and returning a Delta_Response containing all node changes since that timestamp.
5. THE Polling_API SHALL return the Delta_Response within 500 milliseconds for cities with up to 500 active nodes.
6. THE Delta_Response SHALL include pulse score updates, state changes, new node creations, and active live signals for nodes that changed since the requested timestamp.
7. THE Staff_App SHALL retain its existing WebSocket infrastructure with no modifications to staff WebSocket hooks or connection logic.

### Requirement 2: Signal Submission

**User Story:** As a user at or near a venue, I want to report what genre is playing and how long the queue is, so that other users can see live conditions before visiting.

#### Acceptance Criteria

1. THE Signal_API SHALL expose `POST /v1/signals` accepting a signal submission with fields: `nodeId`, `type` (genre_playing or queue_length), `value` (a valid MusicGenre or queue chip value), and optional `lat`/`lng` coordinates.
2. WHEN a Genre_Signal is submitted, THE Signal_API SHALL validate that the value is one of the 12 defined MusicGenre values.
3. WHEN a Queue_Signal is submitted, THE Signal_API SHALL validate that the value is one of: `none`, `short`, `long`.
4. THE Signal_API SHALL require Cognito consumer authentication for all signal submissions.
5. WHEN the submitted `lat`/`lng` coordinates are within 150 metres of the node's location (haversine distance), THE Signal_API SHALL classify the report as a Proximity_Report with higher confidence weight.
6. WHEN no `lat`/`lng` coordinates are provided or the haversine distance exceeds 150 metres (i.e., is 151 metres or greater), THE Signal_API SHALL classify the report as a Remote_Report with standard confidence weight.
7. THE Signal_API SHALL store each Signal in the app-data DynamoDB table with partition key `SIGNAL#<nodeId>` and sort key `<timestamp>#<userId>`.
8. THE Signal_API SHALL accept signal submissions from all authenticated users regardless of Reporter_Weight. Users with Reporter_Weight at the minimum (0.1) have their signals accepted but weighted minimally in the consensus (soft-ban).
9. THE Signal_API SHALL enforce a rate limit of 1 signal per type per node per user per 5 minutes to prevent spam.
10. WHEN a user submits a signal for the same type and node within 2 minutes of their previous submission, THE Signal_API SHALL treat it as a correction (overwrite) rather than a new signal, allowing users to fix accidental mis-taps without waiting for the cooldown.

### Requirement 3: Signal Display on Map

**User Story:** As a consumer browsing the map, I want to see a genre glyph on venue markers that have a recent live genre report, so that I can quickly identify what music is playing nearby.

#### Acceptance Criteria

1. WHEN a node has an active Genre_Signal with Confidence_Score above 0.15, THE Consumer_App SHALL replace the standard pulsing circle marker with a Genre_Glyph icon that pulses based on the node's pulseScore. The Genre_Glyph becomes the marker itself (not an overlay).
2. THE Genre_Glyph SHALL visually represent the consensus genre using a distinct icon for each of the 12 MusicGenre values.
3. WHEN a Genre_Signal's Confidence_Score decays below 0.15, THE Consumer_App SHALL revert the marker back to the standard pulsing circle.
4. WHEN no live Genre_Signal exists for a node (including signals with zero confidence) but the node has an aggregate crowd taste profile (from Spotify/Apple Music data), THE Consumer_App SHALL display the genre glyph in a muted/faded style (no pulse animation) with a Predicted_Indicator visual cue. A live signal with any confidence above 0.0 SHALL prevent predicted data from displaying.
5. THE Predicted_Indicator SHALL be visually distinct from live Genre_Glyphs (muted opacity, no pulse animation, and a "predicted" label on tap) so users can distinguish reported data from inferred data.
6. THE Genre_Glyph SHALL have a minimum touch target of 44px for accessibility compliance.
7. WHEN a Genre_Signal has Confidence_Score between 0.15 and 0.3, THE Consumer_App SHALL display the Genre_Glyph with a "1 report" indicator to signal low confidence to users while still showing activity.
8. THE Consumer_App SHALL provide a "Genre Legend" accessible from the map view (e.g., via a legend button or in settings) that displays all 12 genre icons with their corresponding genre names, so users can learn what each glyph represents.

### Requirement 4: Signal Display in Node Detail Sheet

**User Story:** As a consumer viewing a venue's detail sheet, I want to see the current live signals (genre and queue), so that I can decide whether to visit.

#### Acceptance Criteria

1. WHEN a node has an active Genre_Signal, THE Consumer_App SHALL display the genre name, a confidence indicator (high/medium/low based on Confidence_Score thresholds: high >= 0.7, medium >= 0.4, low >= 0.15), and the time since the most recent report.
2. WHEN a node has an active Queue_Signal, THE Consumer_App SHALL display the queue length chip (none/short/long), a confidence indicator, and the time since the most recent report.
3. WHEN a signal is an Owner_Report, THE Consumer_App SHALL display a badge indicating "Owner report" alongside the signal.
4. WHEN no live signals exist for a node, THE Consumer_App SHALL display the aggregate crowd taste profile with a Predicted_Indicator label stating "Based on visitor music preferences" and the top 3 genres from the taste profile. WHEN any live signal exists, THE Consumer_App SHALL strictly hide all fallback UI elements.
5. THE Consumer_App SHALL display the total number of reports contributing to the current consensus signal.

### Requirement 5: Confidence Scoring and Decay

**User Story:** As a product owner, I want signals scored by confidence so that unreliable or stale reports are deprioritized, ensuring users see trustworthy information.

#### Acceptance Criteria

1. THE Signal_Aggregator SHALL compute Confidence_Score as a function of: recency (time since report), report count (number of agreeing reports), reporter tier (higher tiers contribute more), proximity (Proximity_Reports weighted 1.5x versus Remote_Reports), and contradictions (disagreeing reports reduce confidence).
2. THE Signal_Aggregator SHALL apply the Decay_Function such that Genre_Signal confidence reaches zero after 60 minutes with no new confirming reports.
3. THE Signal_Aggregator SHALL apply the Decay_Function such that Queue_Signal confidence reaches zero after 30 minutes with no new confirming reports.
4. WHEN multiple Genre_Signals exist for the same node with different values, THE Signal_Aggregator SHALL select the genre with the highest aggregate weighted score as the consensus.
5. WHEN the highest-scoring genre has a Confidence_Score below 0.15, THE Signal_Aggregator SHALL treat the node as having no active Genre_Signal.
6. THE Signal_Aggregator SHALL recompute the consensus signal for a node each time a new Signal is submitted for that node. IF consensus recomputation fails, THE Signal_Aggregator SHALL continue with the existing consensus and retry recomputation in the background.
7. THE Signal_Aggregator SHALL store the computed consensus and Confidence_Score on the node record for efficient retrieval by the Polling_API.

### Requirement 6: Reputation System

**User Story:** As a user, I want to earn Reputation points for submitting signals, so that I am incentivized to contribute live venue data.

#### Acceptance Criteria

1. WHEN a user submits a valid Signal, THE Signal_API SHALL increment the user's Reputation stat by 1 point.
2. WHEN a user submits a Proximity_Report, THE Signal_API SHALL increment the user's Reputation stat by 2 points (instead of 1).
3. THE Consumer_App SHALL display the user's Reputation stat on their profile page as a separate metric from check-in count and tier.
4. THE Reputation stat SHALL NOT contribute to tier progression (local → regular → fixture → institution → legend). THE Consumer_App MAY display the Reputation score near tier information for context, but it SHALL NOT influence tier calculations.
5. THE Consumer_App SHALL display a Reputation leaderboard showing the top reporters in the user's city.

### Requirement 7: Owner Reporting and Badging

**User Story:** As a venue owner, I want to submit signals on my own venue that are clearly badged, so that consumers can see official venue updates while knowing the source.

#### Acceptance Criteria

1. WHEN a business owner submits a Signal for a node belonging to their business, THE Signal_API SHALL tag the Signal as an Owner_Report.
2. THE Signal_Aggregator SHALL include Owner_Reports in the confidence calculation with the same weight as a fixture-tier Proximity_Report.
3. THE Consumer_App SHALL display Owner_Reports with a distinct visual badge (e.g., verified checkmark with "Owner" label) in the node detail sheet.
4. THE Signal_API SHALL allow business owners to submit signals via the business Cognito pool authentication only. IF a business owner also has a consumer account, THE Signal_API SHALL restrict them to business Cognito authentication for signal submissions on their own venue.
5. THE Signal_API SHALL limit business owners to 1 Owner_Report per signal type per node per 30 minutes.

### Requirement 8: Owner Signal Dispute

**User Story:** As a venue owner, I want to dispute crowd signals that are incorrect about my venue, so that misleading information can be reviewed and corrected.

#### Acceptance Criteria

1. THE Signal_API SHALL expose `POST /v1/signals/:signalId/dispute` accepting a reason field (free text, max 500 characters) and requiring business Cognito authentication.
2. THE Signal_API SHALL verify that the disputing business owns the node associated with the disputed Signal before accepting the dispute. WHEN ownership verification passes, THE Signal_API SHALL automatically accept the dispute for processing.
3. WHEN a Signal_Dispute is created, THE Signal_API SHALL store it in the app-data DynamoDB table with partition key `DISPUTE#<nodeId>` and sort key `<timestamp>#<businessId>`.
4. WHEN a Signal_Dispute is created, THE Signal_API SHALL reduce the disputed signal's confidence weight by 50% pending admin review.
5. THE Signal_API SHALL prevent a business from submitting more than 5 disputes per day. WHEN a business attempts to submit a 6th dispute in a day, THE Signal_API SHALL reject the submission and return an error.

### Requirement 9: Admin Moderation of Disputed Signals

**User Story:** As an admin, I want to review disputed signals and take action, so that incorrect or abusive signals are resolved fairly.

#### Acceptance Criteria

1. THE Admin_Review_Queue SHALL display all pending Signal_Disputes with: the disputed signal details (type, value, reporter info), the dispute reason, the venue name, and the owner's business name.
2. THE Admin_Review_Queue SHALL allow admins to resolve a dispute with one of three actions: dismiss (signal stands, dispute rejected), uphold (signal removed, reporter penalized), or expire (signal removed, no penalty).
3. WHEN an admin upholds a dispute, THE Signal_Aggregator SHALL remove the disputed signal from the consensus calculation and reduce the reporter's Reporter_Weight by 0.1 (minimum 0.0).
4. WHEN an admin dismisses a dispute, THE Signal_Aggregator SHALL restore the disputed signal's full confidence weight only if the signal was previously removed or penalized. IF the signal was never removed from the consensus calculation, THE Signal_Aggregator SHALL take no action on the signal's weight.
5. THE Admin_Review_Queue SHALL require admin Cognito authentication with role `support_agent` or `super_admin`.

### Requirement 10: Anti-Abuse Rules

**User Story:** As a product owner, I want anti-abuse mechanisms to prevent users from gaming the signal system, so that signal data remains trustworthy.

#### Acceptance Criteria

1. THE Signal_Aggregator SHALL assign Reporter_Weight based on user tier: legend = 2.0, institution = 1.8, fixture = 1.5, regular = 1.2, local = 1.0.
2. WHEN a user's signal contradicts the current majority consensus (different genre or different queue value from 3+ agreeing reports), THE Signal_API SHALL flag the report for potential inaccuracy.
3. WHEN a user accumulates 10 or more flagged contradictions within a 7-day window, THE Signal_API SHALL reduce the user's Reporter_Weight by 0.2 (minimum 0.1). The minimum of 0.1 ensures users are never fully banned in V1; their signals are accepted but carry minimal weight (soft-ban).
4. THE Signal_API SHALL allow a single user to submit exactly 50 signals per day across all nodes. WHEN a user attempts to submit a 51st signal, THE Signal_API SHALL reject the submission.
5. THE Signal_Aggregator SHALL require at least 2 agreeing reports from different users before a signal reaches Confidence_Score 0.7 (high confidence), preventing a single user from establishing high-confidence signals alone.

### Requirement 11: Fallback to Aggregate Taste Profile

**User Story:** As a consumer, I want to see predicted genre information even when no one has reported live, so that I always have some indication of a venue's music style.

#### Acceptance Criteria

1. WHEN no active Genre_Signal exists for a node (all signals expired or Confidence_Score below 0.15) AND the node has CrowdVibeSnapshot data available, THE Consumer_App SHALL display the top genre from the node's CrowdVibeSnapshot genreCounts data.
2. THE Consumer_App SHALL display the fallback genre with a Predicted_Indicator showing muted styling and the label "Predicted from visitor tastes".
3. WHEN a node has neither live signals nor CrowdVibeSnapshot data, THE Consumer_App SHALL display no genre information on the map marker or detail sheet.
4. WHEN a live Genre_Signal becomes active for a node that was showing a predicted genre, THE Consumer_App SHALL replace the predicted display with the live signal display within the next polling cycle (10 seconds maximum).

### Requirement 12: Signal Data Storage and TTL

**User Story:** As a developer, I want signals stored efficiently with automatic expiration, so that stale data is cleaned up without manual intervention.

#### Acceptance Criteria

1. THE Signal_API SHALL store each Signal with a DynamoDB TTL attribute set to 24 hours after submission time, ensuring individual reports are automatically deleted.
2. THE Signal_Aggregator SHALL store the computed consensus for each node with fields: `consensusGenre`, `consensusGenreConfidence`, `consensusQueue`, `consensusQueueConfidence`, `lastUpdatedAt`, `reportCount`.
3. THE Signal_Aggregator SHALL store consensus data on the node record (partition key `NODE#<nodeId>`) to enable efficient single-query retrieval by the Polling_API.
4. THE Polling_API SHALL include consensus signal data in the Delta_Response only for nodes whose consensus actually changed since the requested `since` timestamp. Nodes with no consensus updates (where lastUpdatedAt is null or before the since timestamp) SHALL be excluded from the response.

### Requirement 13: Signal Submission UI

**User Story:** As a consumer, I want a simple interface to report what's happening at a venue, so that contributing signals is quick and frictionless.

#### Acceptance Criteria

1. THE Consumer_App SHALL display a "Report Signal" button in the node detail sheet for authenticated users.
2. WHEN the user taps "Report Signal", THE Consumer_App SHALL present a bottom sheet with two sections: genre selection (12 genre chips) and queue length selection (3 chips: none, short, long).
3. THE Consumer_App SHALL allow the user to submit one or both signal types in a single interaction.
4. WHEN the user's device provides GPS coordinates, THE Consumer_App SHALL include them in the submission automatically (with prior location permission).
5. WHEN the signal is submitted successfully, THE Consumer_App SHALL display a confirmation with the Reputation points earned. WHEN submission fails, THE Consumer_App SHALL hide the points display entirely and show only the error message.
6. THE Consumer_App SHALL disable the "Report Signal" button for a signal type for 5 minutes after a successful submission for that type on the same node (matching the rate limit), except during the 2-minute correction window where the button shows "Correct" instead.
7. THE Consumer_App SHALL only show Reputation points as part of the success confirmation message, never separately from the submission result.
