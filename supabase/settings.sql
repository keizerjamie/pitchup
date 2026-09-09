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
--   cyclus_week_correctie -- handmatig gezette cyclusweek (zie hieronder)
-- Voor de kleuren geldt: geen rij = niet ingesteld = fallback in de app
-- (lib/club-colors.ts, CLUB_COLOR_FALLBACK). Resetten verwijdert de rij; er
-- wordt bewust nooit een lege string opgeslagen (value is NOT NULL). Er staat
-- met opzet geen CHECK-constraint op het formaat: dit is een gedeelde
-- key/value-tabel en de app normaliseert al vóór het schrijven.
--
-- cyclus_week_correctie: vorm '<week>|<YYYY-MM-DD>|<anker of leeg>', bijvoorbeeld
-- '6|2026-09-08|2026-08-01' of '6|2026-09-08|' (nog geen enkele nulmeting).
-- week = 1..6, datum = de dag van instellen, derde segment = het AFGELEIDE anker
-- op dat moment. Wijkt het afgeleide anker daar later van af, dan vervalt de
-- correctie op leestijd (actieveCorrectie in lib/periodization.ts); er wordt
-- niets opgeruimd. Geen rij = automatisch. Ook hier bewust geen CHECK.
-- Rollback (raakt in de SQL-editor ALLE teams):
--   delete from settings where key = 'cyclus_week_correctie';

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Policy lives in rls.sql:
--   create policy "settings: team_id = auth.uid()" on settings for all
--     using (team_id = auth.uid()) with check (team_id = auth.uid());
