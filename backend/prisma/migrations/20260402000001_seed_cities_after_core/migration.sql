-- Ensure launch cities exist after core tables are created.
-- Safe for existing databases due to ON CONFLICT.

INSERT INTO cities (id, name, slug, country) VALUES
  (gen_random_uuid(), 'Cape Town', 'cape-town', 'ZA'),
  (gen_random_uuid(), 'Johannesburg', 'johannesburg', 'ZA'),
  (gen_random_uuid(), 'Durban', 'durban', 'ZA')
ON CONFLICT (slug) DO NOTHING;
