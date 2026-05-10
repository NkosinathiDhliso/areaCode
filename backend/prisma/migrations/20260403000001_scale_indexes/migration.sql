-- Scale-hardening indexes — addresses the gaps identified in the 1M-user audit.
-- All indexes are CREATE INDEX IF NOT EXISTS so re-running is safe.
-- Concurrent build is NOT used here because it can't run inside a transaction
-- and Prisma migrations are transactional. For very large tables in prod,
-- create these manually with CONCURRENTLY before running the migration.

-- ── check_ins ───────────────────────────────────────────────────────────────
-- Per-neighbourhood time-series queries (V2 leaderboard, neighbourhood vibe).
CREATE INDEX IF NOT EXISTS idx_check_ins_neighbourhood_time
  ON check_ins (neighbourhood_id, checked_in_at DESC)
  WHERE neighbourhood_id IS NOT NULL;

-- Type filter on per-user feed (reward vs presence).
CREATE INDEX IF NOT EXISTS idx_check_ins_user_type_time
  ON check_ins (user_id, type, checked_in_at DESC);

-- ── rewards ─────────────────────────────────────────────────────────────────
-- Active-reward lookup per node (filters slot availability + expiry).
CREATE INDEX IF NOT EXISTS idx_rewards_node_active_expiry
  ON rewards (node_id, is_active, expires_at)
  WHERE is_active = TRUE;

-- Admin queue: list rewards expiring soon.
CREATE INDEX IF NOT EXISTS idx_rewards_expires_at
  ON rewards (expires_at)
  WHERE is_active = TRUE AND expires_at IS NOT NULL;

-- ── reward_redemptions ──────────────────────────────────────────────────────
-- "My redemptions" tab — list a user's redemptions chronologically.
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user_created
  ON reward_redemptions (user_id, created_at DESC);

-- Staff redemption flow — find unredeemed code.
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code
  ON reward_redemptions (redemption_code)
  WHERE redeemed_at IS NULL;

-- ── node_images ─────────────────────────────────────────────────────────────
-- Postgres FK does NOT auto-index. Without this, deleting a node cascades via seq scan.
CREATE INDEX IF NOT EXISTS idx_node_images_node ON node_images (node_id, display_order);

-- ── reports ─────────────────────────────────────────────────────────────────
-- Admin moderation queue: pending reports oldest-first.
CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports (status, created_at);

-- "Reports against this node" admin view.
CREATE INDEX IF NOT EXISTS idx_reports_node ON reports (node_id);

-- ── nodes ───────────────────────────────────────────────────────────────────
-- City browse + active filter — common composite for /nodes?cityId=X
CREATE INDEX IF NOT EXISTS idx_nodes_city_active
  ON nodes (city_id, is_active)
  WHERE is_active = TRUE;

-- Business-owned nodes lookup.
CREATE INDEX IF NOT EXISTS idx_nodes_business ON nodes (business_id) WHERE business_id IS NOT NULL;

-- Boost expiry (boostUntil column). Allow predicate even if NULL.
-- (Index assumes boost_until column exists; if not yet present, this is a no-op.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'nodes' AND column_name = 'boost_until'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_nodes_boost_until ON nodes (boost_until) WHERE boost_until IS NOT NULL';
  END IF;
END $$;

-- ── users ───────────────────────────────────────────────────────────────────
-- Cognito sub already UNIQUE (handled by Prisma). Add phone index for OTP login lookup.
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- Leaderboard fallback when Redis is unavailable: city + check-in count desc.
CREATE INDEX IF NOT EXISTS idx_users_city_total_checkins
  ON users (city_id, total_check_ins DESC)
  WHERE city_id IS NOT NULL;

-- ── business_accounts ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_business_accounts_tier ON business_accounts (tier);
CREATE INDEX IF NOT EXISTS idx_business_accounts_trial_ends ON business_accounts (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;

-- ── notification_preferences ────────────────────────────────────────────────
-- (PK already user_id — fine.)

-- ── user_push_tokens ────────────────────────────────────────────────────────
-- Send-to-user query: SELECT token FROM user_push_tokens WHERE user_id = ? AND is_active.
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
  ON user_push_tokens (user_id)
  WHERE is_active = TRUE;
