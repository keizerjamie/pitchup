-- ============================================================
-- Pitchup — Trainingstype per training + duur per koppeling (migration)
-- Run this in the Supabase SQL Editor.
--
-- 1) events.trainingstype — 'vct' (VCT-periodisering) of 'teamtactisch'.
--    NOT NULL DEFAULT 'vct': elke bestaande training gedraagt zich daarmee
--    exact als vóór deze migratie, en de telqueries filteren met een simpele
--    .eq('trainingstype','vct'). Een nullable kolom zou elke lezer dwingen tot
--    een OR-filter, en `<> 'teamtactisch'` sluit NULL-rijen STIL uit.
--    Alleen betekenisvol bij type = 'training'; match/meting-rijen krijgen de
--    default en niemand leest hem daar.
-- 2) training_oefeningen.duur_min — TRAINING-specifieke duur van één gekoppelde
--    oefening, in minuten. NULL = geen eigen duur, val terug op
--    oefeningen.duur_min (legacy-rijen én een leeggemaakt veld). 0 = expliciet
--    "geen duur", conform de bestaande > 0-filter in lib/sessie-tijdlijn.ts.
--
-- Backfill: geen. De default (1) resp. NULL (2) dekken alle bestaande rijen.
-- RLS: geen nieuwe policy nodig; "events: team_id = auth.uid()" resp.
-- "training_oefeningen: own team only" (team_id = auth.uid()) dekken beide
-- kolommen (supabase/rls.sql, supabase/training-plan.sql).
-- Rollback: ALTER TABLE ... DROP COLUMN (data van vóór de migratie is intact).
-- ============================================================

BEGIN;

-- 1) events.trainingstype
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS trainingstype TEXT NOT NULL DEFAULT 'vct';

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_trainingstype_check;
ALTER TABLE events
  ADD CONSTRAINT events_trainingstype_check
  CHECK (trainingstype IN ('vct', 'teamtactisch'));

-- 2) training_oefeningen.duur_min
ALTER TABLE training_oefeningen
  ADD COLUMN IF NOT EXISTS duur_min SMALLINT;

ALTER TABLE training_oefeningen
  DROP CONSTRAINT IF EXISTS training_oefeningen_duur_min_bereik;
ALTER TABLE training_oefeningen
  ADD CONSTRAINT training_oefeningen_duur_min_bereik
  CHECK (duur_min IS NULL OR duur_min BETWEEN 0 AND 600);

COMMIT;
