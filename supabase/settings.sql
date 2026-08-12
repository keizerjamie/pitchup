-- Settings table (per-team key/value store)
-- Run this in the Supabase SQL Editor.
-- The app upserts with onConflict 'team_id,key', so the primary key is composite.

CREATE TABLE IF NOT EXISTS settings (
  team_id UUID NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (team_id, key)
);

-- Bekende keys (geen DDL nodig, puur ter documentatie):
--   team_name, team_logo_url, default_attendance,
--   season_start, season_end, training_days, training_time, training_location,
--   team_color_primary   -- clubkleur 1, canoniek '#rrggbb' lowercase
--   team_color_secondary -- clubkleur 2, canoniek '#rrggbb' lowercase
-- Voor de kleuren geldt: geen rij = niet ingesteld = fallback in de app
-- (lib/club-colors.ts, CLUB_COLOR_FALLBACK). Resetten verwijdert de rij; er
-- wordt bewust nooit een lege string opgeslagen (value is NOT NULL). Er staat
-- met opzet geen CHECK-constraint op het formaat: dit is een gedeelde
-- key/value-tabel en de app normaliseert al vóór het schrijven.

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Policy lives in rls.sql:
--   create policy "settings: team_id = auth.uid()" on settings for all
--     using (team_id = auth.uid()) with check (team_id = auth.uid());
