-- Core tables: cities, neighbourhoods, users, business_accounts, nodes
-- Cities and neighbourhoods must be created before users and nodes due to FK references.

-- Cities
CREATE TABLE IF NOT EXISTS cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  country TEXT DEFAULT 'ZA'
);

-- Neighbourhoods (V1 schema for V2 leaderboard)
CREATE TABLE IF NOT EXISTS neighbourhoods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID REFERENCES cities(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  boundary GEOGRAPHY(POLYGON, 4326)
);
CREATE INDEX IF NOT EXISTS idx_neighbourhoods_boundary ON neighbourhoods USING GIST(boundary);

-- Users (consumer accounts)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  city_id UUID REFERENCES cities(id),
  neighbourhood_id UUID REFERENCES neighbourhoods(id),
  tier TEXT DEFAULT 'local'
    CHECK (tier IN ('local','regular','fixture','institution','legend')),
  total_check_ins INTEGER DEFAULT 0,
  cognito_sub TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business accounts
CREATE TABLE IF NOT EXISTS business_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  registration_number TEXT,
  cognito_sub TEXT UNIQUE,
  tier TEXT DEFAULT 'free'
    CHECK (tier IN ('free','starter','growth','pro','payg')),
  trial_ends_at TIMESTAMPTZ,
  payment_grace_until TIMESTAMPTZ,
  yoco_customer_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nodes (businesses/venues)
CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('food','coffee','nightlife','retail','fitness','arts')),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS
    (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
  city_id UUID REFERENCES cities(id),
  business_id UUID REFERENCES business_accounts(id),
  submitted_by UUID REFERENCES business_accounts(id),
  claim_status TEXT DEFAULT 'unclaimed'
    CHECK (claim_status IN ('unclaimed','pending','claimed')),
  claim_cipc_status TEXT
    CHECK (claim_cipc_status IN ('validated','pending_manual','cipc_unavailable','rejected')),
  node_colour TEXT DEFAULT 'default',
  node_icon TEXT,
  qr_checkin_enabled BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GIST index on nodes.location for spatial queries (ST_DWithin)
CREATE INDEX IF NOT EXISTS idx_nodes_location ON nodes USING GIST(location);

-- GIN trigram index on nodes.name for fuzzy text search
CREATE INDEX IF NOT EXISTS idx_nodes_name_trgm ON nodes USING GIN (name gin_trgm_ops);
