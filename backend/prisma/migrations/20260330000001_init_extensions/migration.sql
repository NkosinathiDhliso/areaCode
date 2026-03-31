-- Enable PostGIS for geographic queries (ST_DWithin, GEOGRAPHY columns)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pg_trgm for fuzzy text search on node names
CREATE EXTENSION IF NOT EXISTS pg_trgm;
