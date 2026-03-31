-- Check-ins (partitioned by month for scalable time-series queries)
-- Prisma doesn't natively support PARTITION BY RANGE, so this is raw SQL.

CREATE TABLE IF NOT EXISTS check_ins (
  id UUID DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  node_id UUID NOT NULL REFERENCES nodes(id),
  neighbourhood_id UUID REFERENCES neighbourhoods(id),
  type TEXT NOT NULL DEFAULT 'reward'
    CHECK (type IN ('reward','presence')),
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, checked_in_at)
) PARTITION BY RANGE (checked_in_at);

CREATE INDEX IF NOT EXISTS idx_check_ins_node_time ON check_ins(node_id, checked_in_at);
CREATE INDEX IF NOT EXISTS idx_check_ins_user_time ON check_ins(user_id, checked_in_at);

-- Initial partitions: current month (April 2026) and next month (May 2026)
CREATE TABLE IF NOT EXISTS check_ins_2026_04 PARTITION OF check_ins
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS check_ins_2026_05 PARTITION OF check_ins
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- Rewards
CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id),
  type TEXT NOT NULL
    CHECK (type IN ('nth_checkin','daily_first','streak','milestone','referral','surprise')),
  title TEXT NOT NULL,
  description TEXT,
  trigger_value INTEGER,
  total_slots INTEGER,
  claimed_count INTEGER DEFAULT 0,
  slots_locked BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reward redemptions (idempotent via UNIQUE constraint on reward_id + user_id)
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id UUID NOT NULL REFERENCES rewards(id),
  user_id UUID NOT NULL REFERENCES users(id),
  redemption_code CHAR(6) NOT NULL,
  code_expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reward_id, user_id)
);
