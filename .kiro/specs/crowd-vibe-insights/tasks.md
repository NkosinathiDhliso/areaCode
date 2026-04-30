# Implementation Plan: Crowd Vibe Insights

## Overview

Incremental implementation of the Crowd Vibe Insights feature across the shared package and four apps (web, business, admin, staff). Foundation types and constants are built first, followed by the pure archetype resolver, mock data layer, mock router endpoints, i18n strings, and finally UI components wired into existing screens. All files stay under 400 lines. No emojis in system UI. CSS variables only. Flex-only layouts. Types in `packages/shared/types/index.ts`.

## Tasks

- [x] 1. Add shared types for music genres, dimensions, archetypes, and crowd vibe
  - Add `MusicGenre`, `PersonalityDimension`, `DimensionScoreVector`, `StreamingProvider`, `GenreWeightEntry`, `PersonalityArchetype`, `CrowdVibeSnapshot`, `BusinessMusicAudience`, and `ArchetypeTestResult` types to `packages/shared/types/index.ts`
  - Extend the existing `User` interface with optional `musicGenres`, `dimensionScores`, `archetypeId`, and `streamingProvider` fields
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 12.1, 12.2, 12.3, 12.6, 14.1, 14.2, 14.3, 11.1_

- [x] 2. Create constants for genre weights and archetype catalog
  - [x] 2.1 Create `packages/shared/constants/genre-weights.ts`
    - Export `MUSIC_GENRES: MusicGenre[]` (ordered list of all 12 genres)
    - Export `PERSONALITY_DIMENSIONS: PersonalityDimension[]` (ordered list of all 5 dimensions)
    - Export `GENRE_WEIGHT_MATRIX: GenreWeightEntry[]` with the full 12×5 seed matrix from Requirement 7.2
    - _Requirements: 7.1, 7.2, 1.1, 1.2_
  - [x] 2.2 Create `packages/shared/constants/archetype-catalog.ts`
    - Export `ARCHETYPE_CATALOG: PersonalityArchetype[]` with all 15 seed archetypes from Requirement 9.2
    - Each entry includes `id`, `name`, `iconId` (string, no emoji), `description`, `dimensionThresholds`, `priority`, and `isActive: true`
    - _Requirements: 9.1, 9.2, 1.4_
  - [x] 2.3 Update `packages/shared/constants/index.ts` to re-export new constants
    - Add re-exports for `GENRE_WEIGHT_MATRIX`, `MUSIC_GENRES`, `PERSONALITY_DIMENSIONS`, and `ARCHETYPE_CATALOG`
    - _Requirements: 7.1, 9.1_

- [x] 3. Implement archetype resolver pure functions
  - Create `packages/shared/lib/archetypeResolver.ts` with three pure functions:
    - `computeDimensionScores(genres, weightMatrix)` — averages genre weights, returns null for empty genres
    - `resolveArchetype(scores, archetypes)` — returns highest-priority matching archetype, "The Eclectic" fallback, "The Uncharted" for null scores
    - `matchesArchetype(scores, archetype)` — checks if scores meet all dimension thresholds
  - Update `packages/shared/lib/index.ts` to re-export the three functions
  - _Requirements: 8.1, 8.2, 8.3, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 4. Checkpoint — Verify foundation layer
  - Ensure all types compile, constants are well-formed, and archetype resolver logic is correct. Ask the user if questions arise.

- [x] 5. Create mock data for crowd vibe
  - [x] 5.1 Create `packages/shared/mocks/data/crowdVibe.ts`
    - Assign 2–4 random `MusicGenre` values to each mock user with category-aware biasing
    - Pre-compute `DimensionScoreVector` and resolved `archetypeId` for each mock user using the shared resolver
    - Export `buildCrowdVibeSnapshot(nodeId)` helper that aggregates checked-in users into a `CrowdVibeSnapshot` with category-aware crowd composition (nightlife → Groove Seeker/Firecracker, coffee → Midnight Philosopher/Smooth Operator, arts → Soul Wanderer/Conscious Creative)
    - Export `buildBusinessMusicAudience()` helper returning mock `BusinessMusicAudience` data with genre distribution, archetype breakdown, and peak archetype by time segments
    - _Requirements: 17.1, 17.2, 17.4, 17.5_
  - [x] 5.2 Update `packages/shared/mocks/data/users.ts` to add music fields
    - Add `musicGenres`, `dimensionScores`, `archetypeId`, and `streamingProvider` fields to each of the 15 mock users
    - Current user (`mock-user-4`) gets `streamingProvider: null` so the connect flow can be demonstrated
    - _Requirements: 17.1, 17.2, 1.6_

- [x] 6. Register mock router endpoints for crowd vibe
  - [x] 6.1 Add crowd vibe and streaming endpoints to `packages/shared/mocks/mockRouter.ts`
    - `GET /v1/nodes/:nodeId/crowd-vibe` — returns `buildCrowdVibeSnapshot(nodeId)`
    - `POST /v1/users/me/streaming/connect` — mock instant OAuth success with synthetic tokens
    - `DELETE /v1/users/me/streaming/disconnect` — mock disconnect
    - `PATCH /v1/users/me/genres` — mock manual genre save with validation (1–5 genres)
    - `GET /v1/business/me/audience/music` — returns `buildBusinessMusicAudience()`
    - _Requirements: 16.1, 16.3, 16.4, 17.3, 17.4, 17.5, 6.3_
  - [x] 6.2 Add admin archetype and genre-weight endpoints to `packages/shared/mocks/mockRouter.ts`
    - `GET /v1/admin/archetypes` — returns `ARCHETYPE_CATALOG` sorted by priority desc
    - `POST /v1/admin/archetypes` — mock create with generated ID
    - `PATCH /v1/admin/archetypes/:id` — mock update
    - `POST /v1/admin/archetypes/test` — computes dimension scores and resolves archetype using shared lib functions
    - `GET /v1/admin/genre-weights` — returns `GENRE_WEIGHT_MATRIX`
    - `PATCH /v1/admin/genre-weights` — mock update
    - _Requirements: 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 17.6, 17.7_

- [x] 7. Enhance mock socket with music fields in toast payloads
  - Update `startConsumerEmitter` in `packages/shared/mocks/mockSocket.ts` to include `musicGenres`, `dimensionScores`, and `archetypeId` fields in `toast:new` check-in payloads, sourced from the mock user's pre-computed crowd vibe data
  - _Requirements: 17.8_

- [x] 8. Checkpoint — Verify mock layer
  - Ensure all mock router endpoints resolve correctly and mock socket emits music fields. Ask the user if questions arise.

- [x] 9. Add i18n strings for crowd vibe features
  - [x] 9.1 Add consumer i18n strings to `apps/web/src/i18n/locales/en.json`
    - Keys for crowd vibe section: `crowdVibe.title`, `crowdVibe.genreCount`, `crowdVibe.noData`
    - Keys for streaming section: `profile.streaming.connectSpotify`, `profile.streaming.connectApple`, `profile.streaming.disconnect`, `profile.streaming.connected`, `profile.streaming.consentTitle`, `profile.streaming.consentBody`, `profile.streaming.consentAgree`, `profile.streaming.consentDecline`, `profile.streaming.error`
    - Keys for archetype display: `profile.archetype.title`, `profile.archetype.uncharted`
    - Keys for manual genre selector: `profile.genres.title`, `profile.genres.save`, `profile.genres.max`, `profile.genres.min`
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 15.1, 15.2, 15.3, 15.4, 15.5, 6.1, 6.2, 4.1, 4.2, 4.4_
  - [x] 9.2 Add business i18n strings to `apps/business/src/i18n/locales/en.json`
    - Keys for music insights: `biz.audience.musicTaste`, `biz.audience.personalityTypes`, `biz.audience.peakPersonality`, `biz.audience.minMusicData`
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [x] 9.3 Add admin i18n strings to `apps/admin/src/i18n/locales/en.json`
    - Keys for archetype management: `admin.nav.archetypes`, `admin.nav.genreWeights`, `admin.archetypes.title`, `admin.archetypes.add`, `admin.archetypes.edit`, `admin.archetypes.name`, `admin.archetypes.iconId`, `admin.archetypes.description`, `admin.archetypes.priority`, `admin.archetypes.active`, `admin.archetypes.thresholds`, `admin.archetypes.test`, `admin.archetypes.testResult`, `admin.archetypes.allMatches`, `admin.archetypes.winner`
    - Keys for genre weight editor: `admin.genreWeights.title`, `admin.genreWeights.save`, `admin.genreWeights.invalid`
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 7.3, 7.4, 11.1, 11.2, 11.3, 11.4, 11.5_
  - [x] 9.4 Add staff i18n placeholder (no crowd vibe UI in staff app — no strings needed)
    - Staff app has no crowd vibe surfaces; confirm no i18n changes required
    - _Requirements: none — staff app excluded from crowd vibe UI_

- [x] 10. Build consumer UI components
  - [x] 10.1 Create `apps/web/src/components/CrowdVibeSection.tsx`
    - Fetches `CrowdVibeSnapshot` via `api.get('/v1/nodes/${nodeId}/crowd-vibe')`
    - Renders archetype breakdown as horizontal flex row of badges with iconId + percentage
    - Renders genre counts as flex-wrap row of genre pills with count
    - Hidden when `totalCheckedIn === 0` or no users have music preferences
    - Uses `rounded-2xl` cards, CSS variables, flex-only layout, max 400 lines
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 12.2, 12.3_
  - [x] 10.2 Create `apps/web/src/components/StreamingSection.tsx`
    - When connected: shows provider name + "Disconnect" button
    - When disconnected: shows "Connect Spotify" and "Connect Apple Music" buttons
    - Displays archetype badge with iconId, name, description
    - Displays top genres list ordered by frequency
    - Shows POPIA consent dialog before initiating mock OAuth flow
    - Buttons disabled during API calls per CLAUDE.md Rule 13
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 2.1, 2.7, 3.1, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 10.3 Create `apps/web/src/components/ManualGenreSelector.tsx`
    - Flex-wrap layout of 12 genre pill buttons (toggle on/off)
    - Enforces 1–5 genre selection limit
    - Save button sends `PATCH /v1/users/me/genres`
    - Disabled state during API call
    - Shown only when no streaming service is connected
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

- [x] 11. Integrate consumer components into existing screens
  - [x] 11.1 Add `CrowdVibeSection` to `apps/web/src/components/NodeDetailSheet.tsx`
    - Import and render below the rewards section, above the CTA button
    - Pass `nodeId` prop; section handles its own data fetching
    - _Requirements: 13.1, 13.4_
  - [x] 11.2 Add `StreamingSection` and `ManualGenreSelector` to `apps/web/src/screens/ProfileScreen.tsx`
    - Import and render below the stat cards, above the Friends button
    - `StreamingSection` reads user data from `useUserStore`
    - `ManualGenreSelector` shown within `StreamingSection` when no streaming provider connected
    - _Requirements: 15.1, 15.4, 6.1_

- [x] 12. Checkpoint — Verify consumer UI
  - Ensure NodeDetailSheet shows crowd vibe section and ProfileScreen shows streaming/archetype/genre UI. Ask the user if questions arise.

- [x] 13. Build business UI component and integrate
  - [x] 13.1 Create `apps/business/src/components/MusicInsightsSection.tsx`
    - "Music Taste" card: flex-based horizontal bars showing genre distribution
    - "Personality Types" card: archetype breakdown with iconId badges and percentages
    - "Peak Personality by Time" card: time segments with dominant archetype
    - Hidden behind minimum-data threshold (< 20 unique visitors with music prefs)
    - Fetches via `api.get('/v1/business/me/audience/music')`
    - Uses `rounded-2xl` cards, CSS variables, flex-only layout, max 400 lines
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [x] 13.2 Integrate `MusicInsightsSection` into `apps/business/src/screens/panels/AudiencePanel.tsx`
    - Import and render below the existing Visitors card
    - Component handles its own data fetching and minimum-data gating
    - _Requirements: 14.1_

- [x] 14. Build admin UI components and integrate
  - [x] 14.1 Create `apps/admin/src/components/ArchetypeManagement.tsx`
    - List view of all archetypes with name, iconId, priority, active toggle
    - Add/Edit form: name, iconId, description, dimension thresholds (5 number inputs), priority
    - Active toggle per archetype via `PATCH /v1/admin/archetypes/:id`
    - Fetches via `api.get('/v1/admin/archetypes')`, creates via `api.post`, updates via `api.patch`
    - Uses `rounded-2xl` cards, CSS variables, flex-only layout, max 400 lines
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7_
  - [x] 14.2 Create `apps/admin/src/components/GenreWeightEditor.tsx`
    - Flex-based table layout: rows = 12 genres, columns = 5 dimensions
    - Each cell is an editable number input (0.0–1.0, step 0.1)
    - Validates values are between 0.0 and 1.0 before saving
    - Save button sends `PATCH /v1/admin/genre-weights`
    - Fetches via `api.get('/v1/admin/genre-weights')`
    - _Requirements: 7.3, 7.4_
  - [x] 14.3 Create `apps/admin/src/components/ArchetypeTestTool.tsx`
    - Genre multi-select (same pattern as ManualGenreSelector)
    - "Test" button sends `POST /v1/admin/archetypes/test` with `{ genres }`
    - Displays computed dimension scores (5 values), resolved archetype (name + iconId + description), all matching archetypes in priority order with winner highlighted
    - Empty genre selection shows "The Uncharted"
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [x] 14.4 Integrate admin components into `apps/admin/src/screens/AdminDashboard.tsx`
    - Add `'archetypes'` and `'genre-weights'` to the `Tab` union type
    - Add tab labels: `admin.nav.archetypes` and `admin.nav.genreWeights`
    - Update `getVisibleTabs` to include both new tabs for `super_admin` role
    - Render `ArchetypeManagement` for archetypes tab, `GenreWeightEditor` for genre-weights tab
    - _Requirements: 9.3, 7.3_

- [x] 15. Final checkpoint — Ensure all surfaces render correctly
  - Ensure all four app surfaces (consumer node detail, consumer profile, business audience, admin dashboard) display crowd vibe data from the mock layer. Ask the user if questions arise.

## Notes

- All files must stay under 400 lines per ENGINEERING_STANDARDS.md
- No emojis in system UI — archetype icons use `iconId` strings mapped to SVG icons
- CSS variables only — no hardcoded hex colors
- Flex-only layouts — no CSS grid in shared components
- Types live in `packages/shared/types/index.ts` — no local type redefinitions
- API calls go through the `api` singleton from `packages/shared/lib/api.ts`
- No `window`/`document` in `packages/` files
- Hooks must be placed above all conditional returns
- Buttons disabled during API calls
