# Requirements Document

## Introduction

The consumer "Ranks" leaderboard is structurally non-functional in production. The consumer
read path and the reset worker use the DynamoDB partition key `LEADERBOARD#{cityId}`, but
nothing writes that key. The only leaderboard writer, `updateLeaderboardEntry`, targets a
different key (`LEADERBOARD#{cityId}#{weekEnding}`) and has zero call sites — it and its
sibling `getLeaderboard` are dead code. As a result the Ranks tab returns an empty list and
every user receives `userRank: null` in production, while the `DEV_MODE` branch serves rich
fake entries that make the feature look complete in development and demos.

This feature consolidates the leaderboard onto a single, live key model: increment on
check-in, read the same key on the Ranks tab, reset the same key weekly, and delete the dead
duplicate implementation. Binding rules: `no-fallbacks-no-legacy.md` (one correct path, no
dead/parallel implementations), `dry-reuse-no-duplication.md` (one home per concept),
`honest-presence.md` (counts reflect reality).

Covers audit finding H6 from `docs/DATA_INTEGRITY_AUDIT.md`.

## Glossary

- **Leaderboard_Entry**: A per-user, per-city ranking row holding `userId`, `checkInCount`, and derived `rank`.
- **Leaderboard_Key**: The single canonical DynamoDB partition key for current-period leaderboard entries in the `app-data` table.
- **Leaderboard_Read**: `getLeaderboardTop50` (`social/repository.ts`), backing `GET /v1/leaderboard/:citySlug`.
- **Leaderboard_Incrementer**: The check-in-path logic that updates a user's Leaderboard_Entry when they check in.
- **Leaderboard_Reset**: The EventBridge worker (`workers/leaderboard-reset.ts`) that archives and clears the current-period leaderboard weekly (Monday 00:00 SAST).
- **Pre_Reset_Notifier**: The `preResetHandler` that warns ranked users before the weekly reset.
- **Reporting_Week**: Monday 00:00 SAST to Sunday 23:59 SAST — the leaderboard period.
- **Dead_Writer**: `updateLeaderboardEntry` and `getLeaderboard` in `check-in/dynamodb-repository.ts`, week-keyed and uncalled.

## Requirements

### Requirement 1: Single canonical leaderboard key

**User Story:** As an engineer, I want exactly one leaderboard key model, so that reads, writes, and resets cannot diverge.

#### Acceptance Criteria

1. THE system SHALL define one canonical Leaderboard_Key used by the Leaderboard_Incrementer, Leaderboard_Read, Leaderboard_Reset, and Pre_Reset_Notifier.
2. THE system SHALL remove the Dead_Writer (`updateLeaderboardEntry` and unused `getLeaderboard`) so no second, uncalled leaderboard implementation remains.
3. IF the canonical key encodes the Reporting_Week, THEN the Leaderboard_Read and Leaderboard_Reset SHALL use the same week-derivation so their keys always match.

### Requirement 2: Leaderboard populated on check-in

**User Story:** As a consumer, I want my check-ins to move me up the Ranks, so that the leaderboard reflects real activity.

#### Acceptance Criteria

1. WHEN a consumer's check-in is recorded, THE Leaderboard_Incrementer SHALL create or update that user's Leaderboard_Entry at the canonical Leaderboard_Key for their city and current Reporting_Week.
2. THE Leaderboard_Entry SHALL store a `checkInCount` that reflects the user's check-ins within the current Reporting_Week.
3. THE Leaderboard_Incrementer SHALL run on the live check-in path, not as dead or manually-invoked code.
4. WHERE the write is on the hot check-in path, THE increment SHALL be efficient (a single conditional/atomic update) and SHALL NOT block the check-in response on failure beyond a logged best-effort attempt consistent with existing check-in fan-out behavior.

### Requirement 3: Consumer Ranks reads real data

**User Story:** As a consumer, I want the Ranks tab to show real rankings for my city, so that competition is meaningful.

#### Acceptance Criteria

1. WHEN `GET /v1/leaderboard/:citySlug` is served outside DEV_MODE, THE Leaderboard_Read SHALL return entries from the canonical Leaderboard_Key populated by Requirement 2.
2. WHEN a viewer is outside the top 50, THE system SHALL return that viewer's actual rank and `checkInCount` if they have a Leaderboard_Entry, or a truthful "unranked" state, never a fabricated rank.
3. THE DEV_MODE fake leaderboard SHALL remain for local development but SHALL NOT stand in for production data.

### Requirement 4: Weekly reset covers all entries

**User Story:** As a product owner, I want the weekly reset to fully clear the prior week, so that "weekly" ranks are truly weekly.

#### Acceptance Criteria

1. WHEN the Leaderboard_Reset runs, THE system SHALL archive and clear all current-period Leaderboard_Entries for each city, not only the top 50.
2. THE Leaderboard_Reset SHALL paginate over all entries (no single-page `Limit` cap that leaves lower-ranked entries un-reset).
3. WHEN the new Reporting_Week begins, THE Leaderboard_Read SHALL reflect a cleared board (no stale carry-over counts from the prior week).
4. THE Pre_Reset_Notifier SHALL operate on the same canonical key and week derivation as the reset.

### Requirement 5: No regression to honest presence or discovery rules

**User Story:** As a product owner, I want leaderboard changes to respect existing privacy and honesty rules, so that we do not introduce new gaps.

#### Acceptance Criteria

1. THE leaderboard SHALL continue to apply existing friend-visibility/privacy filtering (`applyFriendVisibility`, `filterByPrivacy`).
2. THE leaderboard SHALL NOT expose individual location trails or violate POPIA aggregation posture.
3. THE change SHALL pass `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm guard:serverless`.
