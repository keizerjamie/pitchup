-- Settings table (per-team key/value store)
-- Run this in the Supabase SQL Editor.
-- The app upserts with onConflict 'team_id,key', so the primary key is composite.

CREATE TABLE IF NOT EXISTS settings (
  team_id UUID NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (team_id, key)
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Policy lives in rls.sql:
--   create policy "settings: team_id = auth.uid()" on settings for all
--     using (team_id = auth.uid()) with check (team_id = auth.uid());
