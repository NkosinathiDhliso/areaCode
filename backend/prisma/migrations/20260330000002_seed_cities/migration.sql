-- Seed initial launch cities for Area Code V1
-- This migration runs before core tables on fresh databases, so guard for table existence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'cities'
  ) THEN
    INSERT INTO cities (id, name, slug, country) VALUES
      (gen_random_uuid(), 'Cape Town', 'cape-town', 'ZA'),
      (gen_random_uuid(), 'Johannesburg', 'johannesburg', 'ZA'),
      (gen_random_uuid(), 'Durban', 'durban', 'ZA')
    ON CONFLICT (slug) DO NOTHING;
  END IF;
END
$$;
