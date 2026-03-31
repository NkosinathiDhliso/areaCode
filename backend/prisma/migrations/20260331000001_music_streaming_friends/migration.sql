-- Add music personality and streaming columns to users
ALTER TABLE users
  ADD COLUMN music_genres TEXT[] DEFAULT '{}',
  ADD COLUMN dimension_scores JSONB,
  ADD COLUMN archetype_id TEXT,
  ADD COLUMN streaming_provider TEXT;

-- Index for crowd vibe aggregation (check-ins joined with user music data)
CREATE INDEX idx_users_archetype_id ON users (archetype_id) WHERE archetype_id IS NOT NULL;
CREATE INDEX idx_users_streaming_provider ON users (streaming_provider) WHERE streaming_provider IS NOT NULL;

-- Index for user search by username (trigram for ILIKE)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_username_trgm ON users USING gin (username gin_trgm_ops);
CREATE INDEX idx_users_display_name_trgm ON users USING gin (display_name gin_trgm_ops);
