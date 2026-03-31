-- Seed initial launch cities for Area Code V1
-- Uses ON CONFLICT DO NOTHING so this migration is idempotent

INSERT INTO cities (id, name, slug, country) VALUES
  (gen_random_uuid(), 'Cape Town', 'cape-town', 'ZA'),
  (gen_random_uuid(), 'Johannesburg', 'johannesburg', 'ZA'),
  (gen_random_uuid(), 'Durban', 'durban', 'ZA')
ON CONFLICT (slug) DO NOTHING;
