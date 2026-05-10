-- Auto-partitioning helper for check_ins.
--
-- The original migration only created partitions for 2026-04 and 2026-05,
-- which means inserts after 2026-06-01 will fail. This migration:
--
--   1. Creates a stored function `ensure_check_ins_partition(month_start)`
--      that creates the requested month's partition if it does not exist.
--   2. Creates a default partition so writes never fail catastrophically
--      (any out-of-range row lands in `check_ins_default` for inspection).
--   3. Pre-creates the next 12 months of partitions so a single deployment
--      buys a full year of safety.
--
-- A Lambda worker (`partition-manager`) runs monthly via EventBridge and
-- calls `ensure_check_ins_partition(now() + 2 months)` to keep the runway
-- topped up.

CREATE OR REPLACE FUNCTION ensure_check_ins_partition(month_start DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  partition_name TEXT;
  range_start    DATE;
  range_end      DATE;
BEGIN
  range_start := DATE_TRUNC('month', month_start)::DATE;
  range_end   := (range_start + INTERVAL '1 month')::DATE;
  partition_name := 'check_ins_' || TO_CHAR(range_start, 'YYYY_MM');

  EXECUTE FORMAT(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF check_ins FOR VALUES FROM (%L) TO (%L)',
    partition_name, range_start, range_end
  );
END;
$$;

-- Default partition (catches anything outside provisioned ranges).
CREATE TABLE IF NOT EXISTS check_ins_default PARTITION OF check_ins DEFAULT;

-- Pre-create the next 12 months from today.
DO $$
DECLARE
  i INT;
BEGIN
  FOR i IN 0..12 LOOP
    PERFORM ensure_check_ins_partition((CURRENT_DATE + (i || ' months')::INTERVAL)::DATE);
  END LOOP;
END $$;
